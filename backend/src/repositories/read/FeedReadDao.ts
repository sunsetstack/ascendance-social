import mongoose, { Model, PipelineStage } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "../base.repository";
import { IFeedReadDao } from "../interfaces/IFeedReadDao";
import { TagRepository } from "../tag.repository";
import {
  CursorPaginationOptions,
  CursorPaginationResult,
  FeedPost,
  IPost,
  PaginationResult,
  TrendingTag,
} from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors, isAppError } from "@/utils/errors";
import { logger } from "@/utils/winston";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_CURSOR_ORDER,
  FeedCursorOrder,
  FeedCursorPayload,
  FeedCursorPendingItem,
} from "@/utils/feedCursor";
import {
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjectionFields,
  normalizeObjectId,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";

type ProjectedFeedPost = FeedPost & {
  _id?: mongoose.Types.ObjectId;
  visibleIdentityId?: mongoose.Types.ObjectId;
  isPersonalized?: boolean;
};

@injectable()
export class FeedReadDao extends BaseRepository<IPost> implements IFeedReadDao {
  constructor(
    @inject(TOKENS.Models.Post) model: Model<IPost>,
    @inject(TOKENS.Repositories.Tag)
    private readonly tagRepository: TagRepository,
  ) {
    super(model);
  }

  private readonly tagIdCacheStore = new Map<
    string,
    { ids: mongoose.Types.ObjectId[]; expiresAt: number }
  >();

  private readonly tagIdCachePromises = new Map<
    string,
    Promise<mongoose.Types.ObjectId[]>
  >();

  private readonly TAG_ID_CACHE_TTL_MS = 5 * 60 * 1000;

  async getFeedForUserCoreWithCursor(
    followingIds: string[],
    favoriteTags: string[],
    options: CursorPaginationOptions,
  ): Promise<CursorPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
      const followingObjectIds = followingIds.map(
        (id) => new mongoose.Types.ObjectId(id),
      );
      const favoriteTagIds = await this.loadFavoriteTagIds(favoriteTags);
      const decodedCursor = options.cursor
        ? decodeFeedCursor(options.cursor, {
            feed: "personalized",
            orders: [FEED_CURSOR_ORDER.PERSONALIZED],
            source: "mongo",
          })
        : null;
      const phase = decodedCursor?.phase ?? "personalized";
      if (phase !== "personalized" && phase !== "backfill") {
        throw Errors.validation("Invalid personalized feed cursor phase");
      }

      const cursorFilter = this.buildPersonalizedCursorFilter(
        phase,
        decodedCursor,
      );
      const personalizationChecks: Record<string, unknown>[] = [];
      if (followingObjectIds.length > 0) {
        personalizationChecks.push({ $in: ["$user", followingObjectIds] });
      }
      if (favoriteTagIds.length > 0) {
        personalizationChecks.push({
          $gt: [
            { $size: { $setIntersection: ["$tags", favoriteTagIds] } },
            0,
          ],
        });
      }

      const pipeline: PipelineStage[] = [
        { $match: ACTIVE_POST_FILTER },
        {
          $addFields: {
            isPersonalized:
              personalizationChecks.length > 0
                ? { $or: personalizationChecks }
                : false,
          },
        },
        { $sort: { isPersonalized: -1, createdAt: -1, _id: -1 } },
        ...this.getVisibleIdentityStages(),
        ...(cursorFilter ? [{ $match: cursorFilter }] : []),
        { $sort: { isPersonalized: -1, createdAt: -1, _id: -1 } },
        { $limit: limit + 1 },
        ...getStandardLookups(),
        {
          $project: {
            ...getStandardProjectionFields(),
            _id: 1,
            visibleIdentityId: 1,
            isPersonalized: 1,
          },
        },
      ];

      const fetched = await this.model
        .aggregate<ProjectedFeedPost>(pipeline)
        .exec();
      const hasMore = fetched.length > limit;
      const results = fetched.slice(0, limit);
      const nextCursor =
        hasMore && results.length > 0
          ? this.buildPersonalizedCursor(results, decodedCursor)
          : undefined;
      const data = results.map(
        ({ _id, visibleIdentityId: _visibleIdentityId, ...rest }) => rest,
      );
      return { data, hasMore, nextCursor };
    } catch (error: unknown) {
      if (isAppError(error) && error.statusCode === 400) throw error;
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to generate cursor feed",
      );
    }
  }

  /**
   * Generates a trending feed using multi-factor trend scoring
   * @deprecated Use getTrendingFeedWithCursor for deep pagination
   * @pattern Multi-Factor Trending Algorithm
   * @strategy Recency + Log(Popularity) + Log(Comments) with configurable weights
   * @complexity O(N log N) aggregation + O(skip) scan cost on skip-based pagination
   * @note Filters to configurable time window (default 14 days) and minimum likes threshold
   * @param limit - Number of posts per page
   * @param skip - Number of posts to skip (avoid deep pagination with this method)
   * @param options - Configuration for time window, minimum likes, and score weights
   * @returns {Promise<PaginationResult<FeedPost>>} Trending posts with computed trend scores
   * @throws {DatabaseError} if score computation or aggregation fails
   */

  async getTrendingFeed(
    limit: number,
    skip: number,
    options?: {
      timeWindowDays?: number;
      minLikes?: number;
      weights?: { recency?: number; popularity?: number; comments?: number };
    },
  ): Promise<PaginationResult<FeedPost>> {
    try {
      const timeWindowDays = options?.timeWindowDays ?? 14;
      const minLikes = options?.minLikes ?? 0;
      const weights = {
        recency: options?.weights?.recency ?? 0.4,
        popularity: options?.weights?.popularity ?? 0.5,
        comments: options?.weights?.comments ?? 0.1,
      };

      const sinceDate = new Date(
        Date.now() - timeWindowDays * 24 * 60 * 60 * 1000,
      );

      const pipeline: PipelineStage[] = [
        {
          $match: withActivePostFilter({
            createdAt: { $gte: sinceDate },
            likesCount: { $gte: minLikes },
          }),
        },
        // compute trend scores before $lookup to sort/paginate early
        {
          $addFields: {
            recencyScore: {
              $divide: [
                1,
                {
                  $add: [
                    1,
                    {
                      $divide: [
                        { $subtract: [new Date(), "$createdAt"] },
                        1000 * 60 * 60 * 24,
                      ],
                    },
                  ],
                },
              ],
            },
            // using natural logarithm to dampen the effect of very high like counts allowing newer posts to compete
            popularityScore: {
              $ln: {
                $add: [{ $max: [0, { $ifNull: ["$likesCount", 0] }] }, 1],
              },
            },
            commentsScore: {
              $ln: {
                $add: [{ $max: [0, { $ifNull: ["$commentsCount", 0] }] }, 1],
              },
            },
          },
        },
        {
          $addFields: {
            trendScore: {
              $add: [
                { $multiply: [weights.recency, "$recencyScore"] },
                { $multiply: [weights.popularity, "$popularityScore"] },
                { $multiply: [weights.comments, "$commentsScore"] },
              ],
            },
          },
        },
        { $sort: { trendScore: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        // now do expensive $lookups only on the paginated result set
        ...getStandardLookups(),
        {
          $project: {
            ...getStandardProjectionFields(),
            viewsCount: { $ifNull: ["$viewsCount", 0] },
            trendScore: 1,
          },
        },
      ];
      const [results, total] = await Promise.all([
        this.model.aggregate(pipeline).exec(),
        this.model.countDocuments({
          ...withActivePostFilter({
            createdAt: { $gte: sinceDate },
            likesCount: { $gte: minLikes },
          }),
        }),
      ]);

      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(skip / limit) + 1;

      return { data: results, total, page: currentPage, limit, totalPages };
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build trending feed",
      );
    }
  }

  /**
   * Generates a chronological feed of newest posts
   * @deprecated Use getNewFeedWithCursor for deep pagination
   * @pattern Chronological Feed
   * @strategy Simple reverse-chronological sorting by creation date
   * @complexity O(N log N) sort + O(skip) scan cost on skip-based pagination
   * @note This feed moves extremely fast, consider short cache TTLs (60s) and cursor pagination
   * @param limit - Number of posts per page
   * @param skip - Number of posts to skip (avoid deep pagination with this method)
   * @returns {Promise<PaginationResult<FeedPost>>} Newest posts in reverse chronological order
   * @throws {DatabaseError} if aggregation pipeline fails
   */

  async getNewFeed(
    limit: number,
    skip: number,
  ): Promise<PaginationResult<FeedPost>> {
    try {
      const pipeline: PipelineStage[] = [
        { $match: ACTIVE_POST_FILTER },
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: skip },
        { $limit: limit },
        ...getStandardLookups(),
        {
          $project: {
            ...getStandardProjectionFields(),
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      const [results, total] = await Promise.all([
        this.model.aggregate(pipeline).exec(),
        this.model.countDocuments(ACTIVE_POST_FILTER),
      ]);
      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(skip / limit) + 1;
      logger.debug("New feed generated", {
        event: "feed.new.generated",
        resultCount: results.length,
        limit,
        skip,
      });
      return { data: results, total, page: currentPage, limit, totalPages };
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build new feed",
      );
    }
  }

  async getTrendingTags(
    limit: number,
    timeWindowHours: number,
  ): Promise<TrendingTag[]> {
    try {
      const windowHours = Math.max(1, timeWindowHours ?? 168);
      const cappedLimit = Math.min(Math.max(limit ?? 5, 1), 20);
      const now = new Date();
      const timeThreshold = new Date(now.getTime() - windowHours * 3600000);

      const pipeline: PipelineStage[] = [
        {
          $match: withActivePostFilter({
            createdAt: { $gte: timeThreshold },
            tags: { $exists: true, $not: { $size: 0 } },
          }),
        },
        {
          $project: {
            tags: 1,
            likesCount: { $ifNull: ["$likesCount", 0] },
            commentsCount: { $ifNull: ["$commentsCount", 0] },
            createdAt: 1,
          },
        },
        { $unwind: "$tags" },
        {
          $lookup: {
            from: "tags",
            localField: "tags",
            foreignField: "_id",
            as: "tagDoc",
          },
        },
        { $unwind: "$tagDoc" },
        {
          $group: {
            _id: "$tagDoc.tag",
            recentPostCount: { $sum: 1 },
            totalLikes: { $sum: "$likesCount" },
            totalComments: { $sum: "$commentsCount" },
            lastUsedAt: { $max: "$createdAt" },
          },
        },
        {
          $addFields: {
            hoursSinceLastUse: {
              $divide: [{ $subtract: [now, "$lastUsedAt"] }, 3600000],
            },
            engagementScore: {
              $add: [
                { $multiply: [{ $ifNull: ["$totalLikes", 0] }, 0.6] },
                { $multiply: [{ $ifNull: ["$totalComments", 0] }, 0.4] },
              ],
            },
            trendingScore: {
              $add: [
                "$recentPostCount",
                { $multiply: ["$engagementScore", 0.5] },
                { $divide: [windowHours, { $add: ["$hoursSinceLastUse", 1] }] },
              ],
            },
          },
        },
        { $sort: { trendingScore: -1, recentPostCount: -1, lastUsedAt: -1 } },
        { $limit: cappedLimit },
        {
          $project: {
            _id: 0,
            tag: "$_id",
            count: "$recentPostCount",
            recentPostCount: "$recentPostCount",
          },
        },
      ];

      return await this.model.aggregate<TrendingTag>(pipeline).exec();
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to compute trending tags",
      );
    }
  }

  /**
   * Cursor-based pagination for the new feed
   * @description more efficient than skip-based pagination for large datasets
   * avoids the O(n) skip cost by using the last document's createdAt+_id as anchor
   * @pattern Cursor Pagination - uses compound sort key (createdAt, _id) for deterministic ordering
   */
  /**
   * Cursor-based pagination for the new chronological feed
   * @recommended Use this for infinite scroll; much more efficient than skip-based pagination
   * @pattern Cursor Pagination with Compound Sort Key
   * @complexity O(1) lookup using index-backed cursor filtering instead of O(skip) scan
   * @performance ~1ms per page vs ~100ms+ for skip-based pagination on deep pages
   * @param options - Cursor options including cursor token, limit, and navigation direction
   * @returns {Promise<CursorPaginationResult<FeedPost>>} Posts with hasMore flag and next/prev cursors
   * @throws {DatabaseError} if cursor decoding or aggregation fails
   * @example
   * // First page
   * const result1 = await repo.getNewFeedWithCursor({ limit: 20 });
   * // Next page using cursor
   * const result2 = await repo.getNewFeedWithCursor({ limit: 20, cursor: result1.nextCursor });
   */

  async getNewFeedWithCursor(
    options: CursorPaginationOptions,
  ): Promise<CursorPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
      const direction = options.direction ?? "forward";
      const decodedCursor = options.cursor
        ? decodeFeedCursor(options.cursor, {
            feed: "new",
            orders: [FEED_CURSOR_ORDER.NEW],
            source: "mongo",
          })
        : null;
      const cursorFilter = this.buildCreatedAtCursorFilter(
        decodedCursor,
        direction,
      );
      const seenIdentityIds = this.toObjectIds(decodedCursor?.seen ?? []);

      const sortDirection = direction === "forward" ? -1 : 1;

      const pipeline: PipelineStage[] = [
        { $match: ACTIVE_POST_FILTER },
        { $sort: { createdAt: -1, _id: -1 } },
        ...this.getVisibleIdentityStages(),
        ...(seenIdentityIds.length > 0
          ? [{ $match: { visibleIdentityId: { $nin: seenIdentityIds } } }]
          : []),
        ...(cursorFilter ? [{ $match: cursorFilter }] : []),
        { $sort: { createdAt: sortDirection, _id: sortDirection } },
        { $limit: limit + 1 },
        ...getStandardLookups(),
        {
          $project: {
            ...getStandardProjectionFields(),
            _id: 1,
            visibleIdentityId: 1,
            createdAt: 1,
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      let results = await this.model.aggregate(pipeline).exec();

      if (direction === "backward") {
        results = results.reverse();
      }

      const hasMore = results.length > limit;
      if (hasMore) {
        results = results.slice(0, limit);
      }

      const nextCursor =
        hasMore && results.length > 0
          ? this.buildNewCursor(results, decodedCursor, results.length - 1)
          : undefined;
      const prevCursor =
        results.length > 0
          ? this.buildNewCursor(results, decodedCursor, 0)
          : undefined;
      const data = results.map(
        ({ _id, visibleIdentityId: _visibleIdentityId, ...rest }) => rest,
      );

      return { data, hasMore, nextCursor, prevCursor };
    } catch (error: unknown) {
      if (isAppError(error) && error.statusCode === 400) throw error;
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build cursor-paginated feed",
      );
    }
  }

  /**
   * Cursor-based pagination for trending feed
   * @description optimized for deep pagination on trending posts
   * @pattern Cursor Pagination - uses (trendScore, _id) compound key for deterministic ordering
   */
  /**
   * Cursor-based pagination for trending feed
   * @recommended Preferred over getTrendingFeed for production infinite scroll
   * @pattern Cursor Pagination with Computed Field Filtering
   * @complexity O(1) cursor lookup vs O(skip) scan in getTrendingFeed
   * @performance Ideal for deep pagination (page 100+) where skip becomes expensive
   * @param options - Cursor options with time window, min likes, weights, and cursor navigation
   * @returns {Promise<CursorPaginationResult<FeedPost>>} Trending posts with trend scores and cursors
   * @throws {DatabaseError} if cursor decoding or score computation fails
   */

  async getTrendingFeedWithCursor(
    options: CursorPaginationOptions & {
      timeWindowDays?: number;
      minLikes?: number;
      weights?: { recency?: number; popularity?: number; comments?: number };
    },
  ): Promise<CursorPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
      const direction = options.direction ?? "forward";
      const timeWindowDays = options.timeWindowDays ?? 14;
      const minLikes = options.minLikes ?? 0;
      const weights = {
        recency: options.weights?.recency ?? 0.4,
        popularity: options.weights?.popularity ?? 0.5,
        comments: options.weights?.comments ?? 0.1,
      };
      const decodedCursor = options.cursor
        ? decodeFeedCursor(options.cursor, {
            feed: "trending",
            orders: [FEED_CURSOR_ORDER.TRENDING],
            source: "mongo",
          })
        : null;
      const asOf = decodedCursor?.asOf
        ? new Date(decodedCursor.asOf)
        : new Date();

      const sinceDate = new Date(
        asOf.getTime() - timeWindowDays * 24 * 60 * 60 * 1000,
      );

      let cursorFilter: Record<string, unknown> = {};
      if (decodedCursor?.trendScore !== undefined && decodedCursor._id) {
        try {
          const cursorScore = decodedCursor.trendScore;
          const cursorId = new mongoose.Types.ObjectId(decodedCursor._id);

          // cursor pagination on computed fields requires comparing both score and _id
          if (direction === "forward") {
            cursorFilter = {
              $or: [
                { trendScore: { $lt: cursorScore } },
                { trendScore: cursorScore, _id: { $lt: cursorId } },
              ],
            };
          } else {
            cursorFilter = {
              $or: [
                { trendScore: { $gt: cursorScore } },
                { trendScore: cursorScore, _id: { $gt: cursorId } },
              ],
            };
          }
        } catch {
          throw Errors.validation("Invalid trending feed cursor");
        }
      }
      const seenIdentityIds = this.toObjectIds(decodedCursor?.seen ?? []);

      const sortDirection = direction === "forward" ? -1 : 1;
      const feedProjection = getStandardProjectionFields();
      const fetchLimit = Math.max(limit * 2 + 1, limit + 1);

      const pipeline: PipelineStage[] = [
        {
          $match: withActivePostFilter({
            createdAt: { $gte: sinceDate },
            likesCount: { $gte: minLikes },
          }),
        },
        // compute trend scores before cursor filtering
        {
          $addFields: {
            recencyScore: {
              $divide: [
                1,
                {
                  $add: [
                    1,
                    {
                      $divide: [
                        { $subtract: [asOf, "$createdAt"] },
                        1000 * 60 * 60 * 24,
                      ],
                    },
                  ],
                },
              ],
            },
            popularityScore: {
              $ln: {
                $add: [{ $max: [0, { $ifNull: ["$likesCount", 0] }] }, 1],
              },
            },
            commentsScore: {
              $ln: {
                $add: [{ $max: [0, { $ifNull: ["$commentsCount", 0] }] }, 1],
              },
            },
          },
        },
        {
          $addFields: {
            trendScore: {
              $add: [
                { $multiply: [weights.recency, "$recencyScore"] },
                { $multiply: [weights.popularity, "$popularityScore"] },
                { $multiply: [weights.comments, "$commentsScore"] },
              ],
            },
          },
        },
        { $sort: { trendScore: sortDirection, _id: sortDirection } },
        ...this.getVisibleIdentityStages(),
        ...(seenIdentityIds.length > 0
          ? [{ $match: { visibleIdentityId: { $nin: seenIdentityIds } } }]
          : []),
        ...(seenIdentityIds.length === 0 &&
        Object.keys(cursorFilter).length > 0
          ? [{ $match: cursorFilter }]
          : []),
        { $sort: { trendScore: sortDirection, _id: sortDirection } },
        { $limit: fetchLimit },
        // populate relationships only on paginated results
        ...getStandardLookups(),
        {
          $project: {
            ...feedProjection,
            _id: 1,
            visibleIdentityId: 1,
            trendScore: 1,
            createdAt: 1,
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      let fetched = await this.model.aggregate<ProjectedFeedPost>(pipeline).exec();

      // reverse if backward pagination
      if (direction === "backward") {
        fetched = fetched.reverse();
      }

      const scorePage = this.prepareScorePage(
        fetched,
        limit,
        decodedCursor,
      );
      const results = scorePage.data;
      const hasMore = scorePage.hasMore;

      const nextCursor =
        hasMore && results.length > 0
          ? this.buildScoreCursor(
              "trending",
              FEED_CURSOR_ORDER.TRENDING,
              "trendScore",
              results,
              decodedCursor,
              asOf,
              results.length - 1,
              scorePage.pending,
            )
          : undefined;
      const prevCursor =
        results.length > 0
          ? this.buildScoreCursor(
              "trending",
              FEED_CURSOR_ORDER.TRENDING,
              "trendScore",
              results,
              decodedCursor,
              asOf,
              0,
            )
          : undefined;
      const data = results.map(
        ({ _id, visibleIdentityId: _visibleIdentityId, ...rest }) => rest,
      );
      return { data, hasMore, nextCursor, prevCursor };
    } catch (error: unknown) {
      if (isAppError(error) && error.statusCode === 400) throw error;
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build cursor-paginated trending feed",
      );
    }
  }

  /**
   * Cursor-based pagination for ranked feed
   * @pattern Cursor Pagination with Weighted Scoring
   * @complexity scores computed once before cursor filtering
   * @performance Handles deep pagination efficiently without O(skip) overhead
   * @param favoriteTags - Tag names for tag-match scoring component
   * @param options - Cursor navigation with custom score weights
   * @returns {Promise<CursorPaginationResult<FeedPost>>} Ranked posts with rank scores and cursors
   * @throws {DatabaseError} if cursor decoding or ranking fails
   */

  async getRankedFeedWithCursor(
    favoriteTags: string[],
    options: CursorPaginationOptions & {
      cursorFeed?: "for-you" | "personalized";
      weights?: { recency?: number; popularity?: number; tagMatch?: number };
    },
  ): Promise<CursorPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
      const direction = options.direction ?? "forward";
      const weights = {
        recency: 0.5,
        popularity: 0.3,
        tagMatch: 0.2,
        ...options.weights,
      };
      const cursorFeed = options.cursorFeed ?? "for-you";
      const cursorOrder =
        cursorFeed === "personalized"
          ? FEED_CURSOR_ORDER.PERSONALIZED_RANKED
          : FEED_CURSOR_ORDER.FOR_YOU;
      const decodedCursor = options.cursor
        ? decodeFeedCursor(options.cursor, {
            feed: cursorFeed,
            orders: [cursorOrder],
            source: "mongo",
          })
        : null;
      const asOf = decodedCursor?.asOf
        ? new Date(decodedCursor.asOf)
        : new Date();

      const recentThresholdDays = 90;
      const sinceDate = new Date(
        asOf.getTime() - recentThresholdDays * 24 * 60 * 60 * 1000,
      );
      const favoriteTagIds = await this.loadFavoriteTagIds(favoriteTags);
      const hasTagPreferences = favoriteTagIds.length > 0;

      let cursorFilter: Record<string, unknown> = {};
      if (decodedCursor?.rankScore !== undefined && decodedCursor._id) {
        try {
          const cursorScore = decodedCursor.rankScore;
          const cursorId = new mongoose.Types.ObjectId(decodedCursor._id);

          if (direction === "forward") {
            cursorFilter = {
              $or: [
                { rankScore: { $lt: cursorScore } },
                { rankScore: cursorScore, _id: { $lt: cursorId } },
              ],
            };
          } else {
            cursorFilter = {
              $or: [
                { rankScore: { $gt: cursorScore } },
                { rankScore: cursorScore, _id: { $gt: cursorId } },
              ],
            };
          }
        } catch {
          throw Errors.validation("Invalid For You feed cursor");
        }
      }
      const seenIdentityIds = this.toObjectIds(decodedCursor?.seen ?? []);

      const sortDirection = direction === "forward" ? -1 : 1;
      const feedProjection = getStandardProjectionFields();
      const fetchLimit = Math.max(limit * 2 + 1, limit + 1);

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ createdAt: { $gte: sinceDate } }) },
        // compute ranking scores before cursor filtering
        {
          $addFields: {
            recencyScore: {
              $divide: [
                1,
                {
                  $add: [
                    1,
                    {
                      $divide: [
                        { $subtract: [asOf, "$createdAt"] },
                        1000 * 60 * 60 * 24,
                      ],
                    },
                  ],
                },
              ],
            },
            popularityScore: {
              $ln: {
                $add: [{ $max: [0, { $ifNull: ["$likesCount", 0] }] }, 1],
              },
            },
            tagMatchScore: hasTagPreferences
              ? { $size: { $setIntersection: ["$tags", favoriteTagIds] } }
              : 0,
          },
        },
        {
          $addFields: {
            rankScore: {
              $add: [
                { $multiply: ["$recencyScore", weights.recency] },
                { $multiply: ["$popularityScore", weights.popularity] },
                { $multiply: ["$tagMatchScore", weights.tagMatch] },
              ],
            },
          },
        },
        { $sort: { rankScore: sortDirection, _id: sortDirection } },
        ...this.getVisibleIdentityStages(),
        ...(seenIdentityIds.length > 0
          ? [{ $match: { visibleIdentityId: { $nin: seenIdentityIds } } }]
          : []),
        ...(seenIdentityIds.length === 0 &&
        Object.keys(cursorFilter).length > 0
          ? [{ $match: cursorFilter }]
          : []),
        { $sort: { rankScore: sortDirection, _id: sortDirection } },
        { $limit: fetchLimit },
        // populate relationships only on paginated results
        ...getStandardLookups(),
        {
          $project: {
            ...feedProjection,
            _id: 1,
            visibleIdentityId: 1,
            rankScore: 1,
            createdAt: 1,
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      let fetched = await this.model.aggregate<ProjectedFeedPost>(pipeline).exec();

      // reverse if backward pagination
      if (direction === "backward") {
        fetched = fetched.reverse();
      }

      const scorePage = this.prepareScorePage(
        fetched,
        limit,
        decodedCursor,
      );
      const results = scorePage.data;
      const hasMore = scorePage.hasMore;

      const nextCursor =
        hasMore && results.length > 0
          ? this.buildScoreCursor(
              cursorFeed,
              cursorOrder,
              "rankScore",
              results,
              decodedCursor,
              asOf,
              results.length - 1,
              scorePage.pending,
            )
          : undefined;
      const prevCursor =
        results.length > 0
          ? this.buildScoreCursor(
              cursorFeed,
              cursorOrder,
              "rankScore",
              results,
              decodedCursor,
              asOf,
              0,
            )
          : undefined;
      const data = results.map(
        ({ _id, visibleIdentityId: _visibleIdentityId, ...rest }) => rest,
      );
      return { data, hasMore, nextCursor, prevCursor };
    } catch (error: unknown) {
      if (isAppError(error) && error.statusCode === 400) throw error;
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build cursor-paginated ranked feed",
      );
    }
  }

  private getVisibleIdentityStages(): PipelineStage[] {
    return [
      {
        $group: {
          _id: { $ifNull: ["$repostOf", "$_id"] },
          post: { $first: "$$ROOT" },
        },
      },
      {
        $replaceRoot: {
          newRoot: {
            $mergeObjects: ["$post", { visibleIdentityId: "$_id" }],
          },
        },
      },
    ];
  }

  private buildCreatedAtCursorFilter(
    cursor: FeedCursorPayload | null,
    direction: "forward" | "backward",
  ): Record<string, unknown> | null {
    if (!cursor) return null;
    if (cursor.createdAt === undefined && cursor._id === undefined) return null;
    if (!cursor.createdAt || !cursor._id) {
      throw Errors.validation("Invalid chronological feed cursor");
    }

    let cursorId: mongoose.Types.ObjectId;
    try {
      cursorId = new mongoose.Types.ObjectId(cursor._id);
    } catch {
      throw Errors.validation("Invalid chronological feed cursor");
    }
    const cursorDate = new Date(cursor.createdAt);
    const comparison = direction === "forward" ? "$lt" : "$gt";
    return {
      $or: [
        { createdAt: { [comparison]: cursorDate } },
        { createdAt: cursorDate, _id: { [comparison]: cursorId } },
      ],
    };
  }

  private buildPersonalizedCursorFilter(
    phase: "personalized" | "backfill",
    cursor: FeedCursorPayload | null,
  ): Record<string, unknown> | null {
    const chronological = this.buildCreatedAtCursorFilter(cursor, "forward");
    if (phase === "backfill") {
      return chronological
        ? { $and: [{ isPersonalized: false }, chronological] }
        : { isPersonalized: false };
    }
    if (!chronological) return null;
    return {
      $or: [
        { isPersonalized: false },
        { $and: [{ isPersonalized: true }, chronological] },
      ],
    };
  }

  private buildPersonalizedCursor(
    results: ProjectedFeedPost[],
    previous: FeedCursorPayload | null,
  ): string {
    const lastItem = results[results.length - 1];
    return encodeFeedCursor({
      feed: "personalized",
      order: FEED_CURSOR_ORDER.PERSONALIZED,
      source: "mongo",
      phase: lastItem.isPersonalized ? "personalized" : "backfill",
      createdAt: new Date(lastItem.createdAt).toISOString(),
      _id: String(lastItem._id),
      seen: previous?.seen,
      seenPublicIds: previous?.seenPublicIds,
    });
  }

  private buildNewCursor(
    results: ProjectedFeedPost[],
    previous: FeedCursorPayload | null,
    anchorIndex: number,
  ): string {
    const anchor = results[anchorIndex];
    return encodeFeedCursor({
      feed: "new",
      order: FEED_CURSOR_ORDER.NEW,
      source: "mongo",
      phase: "new",
      createdAt: new Date(anchor.createdAt).toISOString(),
      _id: String(anchor._id),
      seen: previous?.seen,
      seenPublicIds: previous?.seenPublicIds,
    });
  }

  private buildScoreCursor(
    feed: "for-you" | "personalized" | "trending",
    order: FeedCursorOrder,
    scoreField: "rankScore" | "trendScore",
    results: ProjectedFeedPost[],
    previous: FeedCursorPayload | null,
    asOf: Date,
    anchorIndex: number,
    pendingResults: ProjectedFeedPost[] = [],
  ): string {
    const anchor = results[anchorIndex] as ProjectedFeedPost &
      Record<typeof scoreField, number>;
    const score = anchor[scoreField];
    return encodeFeedCursor({
      feed,
      order,
      source: "mongo",
      phase: feed === "trending" ? "trending" : undefined,
      asOf: asOf.toISOString(),
      _id: String(anchor._id),
      ...(scoreField === "rankScore"
        ? { rankScore: score }
        : { trendScore: score }),
      seen: this.mergeSeenIdentityIds(previous, results),
      seenPublicIds: this.mergeSeenPublicIds(previous, results),
      pending: pendingResults.map((result) => ({
        _id: String(result._id),
      })),
    });
  }

  private prepareScorePage(
    fetched: ProjectedFeedPost[],
    limit: number,
    cursor: FeedCursorPayload | null,
  ): {
    data: ProjectedFeedPost[];
    hasMore: boolean;
    pending: ProjectedFeedPost[];
  } {
    const byId = new Map(
      fetched.map((result) => [String(result._id), result] as const),
    );
    const frozenIds = new Set(
      (cursor?.pending ?? []).map((pending) => pending._id),
    );
    const ordered = [
      ...(cursor?.pending ?? [])
        .map((pending: FeedCursorPendingItem) => byId.get(pending._id))
        .filter((result): result is ProjectedFeedPost => result !== undefined),
      ...fetched.filter((result) => !frozenIds.has(String(result._id))),
    ];

    return {
      data: ordered.slice(0, limit),
      hasMore: ordered.length > limit,
      pending: ordered.slice(limit, limit * 2),
    };
  }

  private mergeSeenIdentityIds(
    previous: FeedCursorPayload | null,
    results: ProjectedFeedPost[],
  ): string[] {
    const seen = new Set(previous?.seen ?? []);
    for (const result of results) {
      const identity = result.visibleIdentityId ?? result._id;
      if (identity) seen.add(String(identity));
    }
    return [...seen];
  }

  private mergeSeenPublicIds(
    previous: FeedCursorPayload | null,
    results: ProjectedFeedPost[],
  ): string[] {
    const seen = new Set(previous?.seenPublicIds ?? []);
    for (const result of results) {
      seen.add(result.repostOf?.publicId ?? result.publicId);
    }
    return [...seen];
  }

  private toObjectIds(ids: string[]): mongoose.Types.ObjectId[] {
    try {
      return ids.map((id) => new mongoose.Types.ObjectId(id));
    } catch {
      throw Errors.validation("Invalid feed cursor identity");
    }
  }

  private async loadFavoriteTagIds(
    tagNames: string[],
  ): Promise<mongoose.Types.ObjectId[]> {
    if (tagNames.length === 0) {
      return [];
    }

    const cacheKey = [...tagNames].sort().join(",");
    const cached = this.tagIdCacheStore.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.ids;
    }

    const inFlight = this.tagIdCachePromises.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const fetchPromise = this.tagRepository
      .findByTags(tagNames)
      .then((tagDocs) =>
        tagDocs.map((doc) => normalizeObjectId(doc._id, "tag._id")),
      )
      .then((ids) => {
        this.tagIdCacheStore.set(cacheKey, {
          ids,
          expiresAt: Date.now() + this.TAG_ID_CACHE_TTL_MS,
        });
        return ids;
      })
      .finally(() => {
        this.tagIdCachePromises.delete(cacheKey);
      });

    this.tagIdCachePromises.set(cacheKey, fetchPromise);
    return fetchPromise;
  }
}
