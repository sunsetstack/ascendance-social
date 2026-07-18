import mongoose, { Model, PipelineStage } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "../base.repository";
import {
  FeedSnapshotPaginationResult,
  IFeedReadDao,
} from "../interfaces/IFeedReadDao";
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
  FeedCursorSnapshot,
  FeedCursorSnapshotEntry,
  hashFeedCursorScope,
} from "@/utils/feedCursor";
import {
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjectionFields,
  normalizeObjectId,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";
import { RedisService } from "@/services/redis.service";

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
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
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
      const scope = hashFeedCursorScope([
        "personalized",
        followingObjectIds.map(String).sort(),
        favoriteTagIds.map(String).sort(),
      ]);
      const decodedCursor = options.cursor
        ? decodeFeedCursor(options.cursor, {
            feed: "personalized",
            orders: [FEED_CURSOR_ORDER.PERSONALIZED],
            source: "mongo",
          })
        : null;
      if (decodedCursor && decodedCursor.scope !== scope) {
        throw Errors.validation("Feed cursor does not match this personalized feed");
      }
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
          ? this.buildPersonalizedCursor(results, scope)
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
      const exclusionSnapshot = decodedCursor?.snapshotId
        ? await this.redisService.requireFeedCursorSnapshot(
            decodedCursor.snapshotId,
            {
              feed: "new",
              order: FEED_CURSOR_ORDER.NEW,
              source: "mongo",
            },
          )
        : null;
      const seenIdentityIds = this.toObjectIds(
        exclusionSnapshot?.excludedIdentityIds ?? [],
      );

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
  ): Promise<FeedSnapshotPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
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
      const snapshotRef = decodedCursor
        ? {
            id: decodedCursor.snapshotId,
            snapshot: await this.redisService.requireFeedCursorSnapshot(
              decodedCursor.snapshotId,
              {
                feed: "trending",
                order: FEED_CURSOR_ORDER.TRENDING,
                source: "mongo",
              },
            ),
          }
        : await this.redisService.getOrCreateFeedCursorSnapshot(
            hashFeedCursorScope([
              "mongo-trending",
              timeWindowDays,
              minLikes,
              weights,
            ]),
            async () => {
              const asOf = new Date();
              const sinceDate = new Date(
                asOf.getTime() - timeWindowDays * 24 * 60 * 60 * 1000,
              );
              const entries = await this.model
                .aggregate<{
                  _id: mongoose.Types.ObjectId;
                  publicId: string;
                  visibleIdentityId: mongoose.Types.ObjectId;
                  trendScore: number;
                }>([
                  {
                    $match: withActivePostFilter({
                      createdAt: { $gte: sinceDate },
                      likesCount: { $gte: minLikes },
                    }),
                  },
                  ...this.getTrendScoreStages(asOf, weights),
                  { $sort: { trendScore: -1, _id: -1 } },
                  ...this.getVisibleIdentityStages(),
                  { $sort: { trendScore: -1, _id: -1 } },
                  { $limit: 50_001 },
                  {
                    $project: {
                      _id: 1,
                      publicId: 1,
                      visibleIdentityId: 1,
                      trendScore: 1,
                    },
                  },
                ])
                .exec();
              return this.buildScoreSnapshot(
                "trending",
                FEED_CURSOR_ORDER.TRENDING,
                entries,
                "trendScore",
              );
            },
          );

      const page = await this.readScoreSnapshotPage(
        snapshotRef.snapshot,
        decodedCursor?.offset ?? 0,
        limit,
        "trendScore",
      );
      const nextCursor = page.hasMore
        ? encodeFeedCursor({
            feed: "trending",
            order: FEED_CURSOR_ORDER.TRENDING,
            source: "mongo",
            phase: "trending",
            snapshotId: snapshotRef.id,
            offset: page.nextOffset,
          })
        : undefined;
      return {
        data: page.data,
        hasMore: page.hasMore,
        nextCursor,
        snapshotId: snapshotRef.id,
        consumedOffset: page.nextOffset,
      };
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
  ): Promise<FeedSnapshotPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
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
      const recentThresholdDays = 90;
      const favoriteTagIds = await this.loadFavoriteTagIds(favoriteTags);
      const hasTagPreferences = favoriteTagIds.length > 0;
      const scope = hashFeedCursorScope([
        "mongo-ranked",
        cursorFeed,
        favoriteTagIds.map(String).sort(),
        weights,
        recentThresholdDays,
      ]);
      const decodedCursor = options.cursor
        ? decodeFeedCursor(options.cursor, {
            feed: cursorFeed,
            orders: [cursorOrder],
            source: "mongo",
          })
        : null;
      if (decodedCursor && decodedCursor.scope !== scope) {
        throw Errors.validation("Feed cursor does not match this ranked feed");
      }

      const snapshotRef = decodedCursor
        ? {
            id: decodedCursor.snapshotId,
            snapshot: await this.redisService.requireFeedCursorSnapshot(
              decodedCursor.snapshotId,
              {
                feed: cursorFeed,
                order: cursorOrder,
                source: "mongo",
                scope,
              },
            ),
          }
        : await this.redisService.getOrCreateFeedCursorSnapshot(
            scope,
            async () => {
              const asOf = new Date();
              const sinceDate = new Date(
                asOf.getTime() - recentThresholdDays * 24 * 60 * 60 * 1000,
              );
              const entries = await this.model
                .aggregate<{
                  _id: mongoose.Types.ObjectId;
                  publicId: string;
                  visibleIdentityId: mongoose.Types.ObjectId;
                  rankScore: number;
                }>([
                  {
                    $match: withActivePostFilter({
                      createdAt: { $gte: sinceDate },
                    }),
                  },
                  ...this.getRankScoreStages(
                    asOf,
                    favoriteTagIds,
                    hasTagPreferences,
                    weights,
                  ),
                  { $sort: { rankScore: -1, _id: -1 } },
                  ...this.getVisibleIdentityStages(),
                  { $sort: { rankScore: -1, _id: -1 } },
                  { $limit: 50_001 },
                  {
                    $project: {
                      _id: 1,
                      publicId: 1,
                      visibleIdentityId: 1,
                      rankScore: 1,
                    },
                  },
                ])
                .exec();
              return this.buildScoreSnapshot(
                cursorFeed,
                cursorOrder,
                entries,
                "rankScore",
                scope,
              );
            },
          );

      const page = await this.readScoreSnapshotPage(
        snapshotRef.snapshot,
        decodedCursor?.offset ?? 0,
        limit,
        "rankScore",
      );
      const nextCursor = page.hasMore
        ? this.buildRankedSnapshotCursor(
            cursorFeed,
            snapshotRef.id,
            page.nextOffset,
            scope,
          )
        : undefined;
      return {
        data: page.data,
        hasMore: page.hasMore,
        nextCursor,
        snapshotId: snapshotRef.id,
        consumedOffset: page.nextOffset,
      };
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
    const createdAt = "createdAt" in cursor ? cursor.createdAt : undefined;
    const id = "_id" in cursor ? cursor._id : undefined;
    if (createdAt === undefined && id === undefined) return null;
    if (!createdAt || !id) {
      throw Errors.validation("Invalid chronological feed cursor");
    }

    let cursorId: mongoose.Types.ObjectId;
    try {
      cursorId = new mongoose.Types.ObjectId(id);
    } catch {
      throw Errors.validation("Invalid chronological feed cursor");
    }
    const cursorDate = new Date(createdAt);
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
    scope: string,
  ): string {
    const lastItem = results[results.length - 1];
    return encodeFeedCursor({
      feed: "personalized",
      order: FEED_CURSOR_ORDER.PERSONALIZED,
      source: "mongo",
      phase: lastItem.isPersonalized ? "personalized" : "backfill",
      createdAt: new Date(lastItem.createdAt).toISOString(),
      _id: String(lastItem._id),
      scope,
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
      ...(previous && "snapshotId" in previous && previous.snapshotId
        ? { snapshotId: previous.snapshotId }
        : {}),
    });
  }

  private getTrendScoreStages(
    asOf: Date,
    weights: { recency: number; popularity: number; comments: number },
  ): PipelineStage[] {
    return [
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
              $add: [
                { $max: [0, { $ifNull: ["$commentsCount", 0] }] },
                1,
              ],
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
    ];
  }

  private getRankScoreStages(
    asOf: Date,
    favoriteTagIds: mongoose.Types.ObjectId[],
    hasTagPreferences: boolean,
    weights: { recency: number; popularity: number; tagMatch: number },
  ): PipelineStage[] {
    return [
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
    ];
  }

  private buildScoreSnapshot(
    feed: "for-you" | "personalized" | "trending",
    order: FeedCursorOrder,
    results: Array<{
      _id: mongoose.Types.ObjectId;
      publicId: string;
      visibleIdentityId: mongoose.Types.ObjectId;
    } & Record<string, unknown>>,
    scoreField: "rankScore" | "trendScore",
    scope?: string,
  ): FeedCursorSnapshot {
    if (results.length > 50_000) {
      throw Errors.internal("Feed cursor snapshot contains too many items");
    }
    return {
      version: 1,
      feed,
      order,
      source: "mongo",
      scope,
      entries: results.map((result) => ({
        _id: String(result._id),
        publicId: result.publicId,
        visibleIdentityId: String(result.visibleIdentityId),
        score: Number(result[scoreField]),
      })),
    };
  }

  private async readScoreSnapshotPage(
    snapshot: FeedCursorSnapshot,
    offset: number,
    limit: number,
    scoreField: "rankScore" | "trendScore",
  ): Promise<{ data: FeedPost[]; hasMore: boolean; nextOffset: number }> {
    const collected: Array<{
      index: number;
      post: ProjectedFeedPost;
      entry: FeedCursorSnapshotEntry;
    }> = [];
    let scanOffset = offset;
    const batchSize = Math.max(limit * 2, 50);

    while (collected.length <= limit && scanOffset < snapshot.entries.length) {
      const batch = snapshot.entries.slice(scanOffset, scanOffset + batchSize);
      const objectIds = this.toObjectIds(batch.map((entry) => entry._id));
      const posts = await this.model
        .aggregate<ProjectedFeedPost>([
          {
            $match: withActivePostFilter({
              _id: { $in: objectIds },
            }),
          },
          ...getStandardLookups(),
          {
            $project: {
              ...getStandardProjectionFields(),
              _id: 1,
              createdAt: 1,
              viewsCount: { $ifNull: ["$viewsCount", 0] },
            },
          },
        ])
        .exec();
      const byId = new Map(posts.map((post) => [String(post._id), post]));

      for (let index = 0; index < batch.length; index += 1) {
        const entry = batch[index];
        const post = byId.get(entry._id);
        if (!post) continue;
        (post as ProjectedFeedPost & Record<string, unknown>)[scoreField] =
          entry.score;
        collected.push({ index: scanOffset + index, post, entry });
        if (collected.length > limit) break;
      }
      scanOffset += batch.length;
    }

    const visible = collected.slice(0, limit);
    const hasMore = collected.length > limit;
    const nextOffset =
      visible.length > 0
        ? visible[visible.length - 1].index + 1
        : snapshot.entries.length;
    const data = visible.map(({ post }) => {
      const result: Partial<ProjectedFeedPost> = { ...post };
      delete result._id;
      delete result.visibleIdentityId;
      return result as FeedPost;
    });
    return { data, hasMore, nextOffset };
  }

  private buildRankedSnapshotCursor(
    feed: "for-you" | "personalized",
    snapshotId: string,
    offset: number,
    scope: string,
  ): string {
    return feed === "personalized"
      ? encodeFeedCursor({
          feed: "personalized",
          order: FEED_CURSOR_ORDER.PERSONALIZED_RANKED,
          source: "mongo",
          snapshotId,
          offset,
          scope,
        })
      : encodeFeedCursor({
          feed: "for-you",
          order: FEED_CURSOR_ORDER.FOR_YOU,
          source: "mongo",
          snapshotId,
          offset,
          scope,
        });
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
