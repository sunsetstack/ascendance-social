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
import { decodeCursor, encodeCursor } from "@/utils/cursorCodec";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import {
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjectionFields,
  normalizeObjectId,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";

type ProjectedFeedPost = FeedPost & {
  _id?: mongoose.Types.ObjectId;
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

      const orConditions: Record<string, unknown>[] = [];
      if (followingObjectIds.length) {
        orConditions.push({ user: { $in: followingObjectIds } });
      }
      if (favoriteTagIds.length) {
        orConditions.push({ tags: { $in: favoriteTagIds } });
      }

      // decode cursor if provided
      const decodedCursor = decodeCursor<{
        phase: "personalized" | "backfill";
        createdAt?: string;
        _id?: string;
      }>(options.cursor);
      let phase: "personalized" | "backfill" =
        decodedCursor?.phase ?? "personalized";
      let cursorFilter: Record<string, unknown> = {};

      if (decodedCursor && decodedCursor.createdAt && decodedCursor._id) {
        try {
          const cursorDate = new Date(decodedCursor.createdAt);
          const cursorId = new mongoose.Types.ObjectId(decodedCursor._id);
          cursorFilter = {
            $or: [
              { createdAt: { $lt: cursorDate } },
              { createdAt: cursorDate, _id: { $lt: cursorId } },
            ],
          };
        } catch {
          return { data: [], hasMore: false };
        }
      }

      let results: ProjectedFeedPost[] = [];

      const feedProjection = {
        ...getStandardProjectionFields(),
        _id: 1,
      };

      if (phase === "personalized" && orConditions.length > 0) {
        const pipeline: PipelineStage[] = [
          { $match: withActivePostFilter({ $or: orConditions }) },
        ];

        if (Object.keys(cursorFilter).length > 0) {
          pipeline.push({ $match: cursorFilter });
        }

        pipeline.push(
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: limit + 1 },
          ...getStandardLookups(),
          {
            $addFields: {
              tagNames: {
                $map: {
                  input: { $ifNull: ["$tagObjects", []] },
                  as: "tag",
                  in: "$$tag.tag",
                },
              },
              isPersonalized: true,
            },
          },
          { $project: feedProjection },
        );

        results = await this.model
          .aggregate<ProjectedFeedPost>(pipeline)
          .exec();
      }

      // Transition to backfill if personalized results dry up
      if (phase === "personalized" && results.length <= limit) {
        const needed = limit + 1 - results.length;

        // We only backfill if there's space left on this page.
        // We do NOT use existingIds $nin. We just rely on chronological order of backfill.
        // There is a slight risk of overlap if a personalized post IS ALSO a recent backfill post,
        // but $nin is too expensive. We can just distinct in memory or accept slight overlap.
        const backfillPipeline: PipelineStage[] = [
          { $match: ACTIVE_POST_FILTER },
          { $sort: { createdAt: -1, _id: -1 } },
          // If we ALREADY fetched some personalized posts on this CURRENT page, we should theoretically offset the backfill.
          // However, to keep it simple, we just start backfill from scratch and cursor tracking will remember where we are based on the Last Backfill Post.
          { $limit: needed },
          ...getStandardLookups(),
          { $addFields: { isPersonalized: false } },
          { $project: feedProjection },
        ];

        // If the user provided a personalized cursor, but we ran out of personalized posts,
        // the backfill cursor starts from the VERY BEGINNING of the backfill collection.
        // So we don't apply the personalized cursorFilter to the backfill!

        const backfillResults = await this.model
          .aggregate<ProjectedFeedPost>(backfillPipeline)
          .exec();

        // Filter out any duplicates (posts that were personalized but also naturally fall in this backfill window)
        const existingIds = new Set(
          results.map((r) => r._id?.toString()).filter(Boolean),
        );
        for (const bp of backfillResults) {
          const backfillId = bp._id?.toString();
          if (backfillId && !existingIds.has(backfillId)) {
            results.push(bp);
          }
        }
      } else if (phase === "backfill") {
        const backfillPipeline: PipelineStage[] = [
          { $match: ACTIVE_POST_FILTER },
        ];
        if (Object.keys(cursorFilter).length > 0) {
          backfillPipeline.push({ $match: cursorFilter });
        }
        backfillPipeline.push(
          { $sort: { createdAt: -1, _id: -1 } },
          { $limit: limit + 1 },
          ...getStandardLookups(),
          { $addFields: { isPersonalized: false } },
          { $project: feedProjection },
        );
        results = await this.model
          .aggregate<ProjectedFeedPost>(backfillPipeline)
          .exec();
      }

      const hasMore = results.length > limit;
      if (hasMore) {
        results = results.slice(0, limit);
      }

      let nextCursor: string | undefined;
      if (hasMore && results.length > 0) {
        const lastItem = results[results.length - 1];
        // If the last item was personalized, we are still in personalized phase.
        // If it was backfill, we are in backfill phase.
        const outgoingPhase = lastItem.isPersonalized
          ? "personalized"
          : "backfill";
        nextCursor = encodeCursor({
          phase: outgoingPhase,
          createdAt: lastItem.createdAt,
          _id: lastItem._id,
        });
      }

      // We don't strictly support prevCursor for this hybrid feed easily, so we omit for now
      const data = results.map(({ _id, ...rest }) => rest);
      return { data, hasMore, nextCursor };
    } catch (error: unknown) {
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

      // decode cursor if provided
      let cursorFilter: Record<string, unknown> = {};
      const decodedCursor = decodeCursor<{ createdAt?: string; _id?: string }>(
        options.cursor,
      );
      if (decodedCursor?.createdAt && decodedCursor._id) {
        try {
          const cursorDate = new Date(decodedCursor.createdAt);
          const cursorId = new mongoose.Types.ObjectId(decodedCursor._id);

          // for forward pagination (newer -> older), get documents older than cursor
          // for backward pagination (older -> newer), get documents newer than cursor
          if (direction === "forward") {
            cursorFilter = {
              $or: [
                { createdAt: { $lt: cursorDate } },
                { createdAt: cursorDate, _id: { $lt: cursorId } },
              ],
            };
          } else {
            cursorFilter = {
              $or: [
                { createdAt: { $gt: cursorDate } },
                { createdAt: cursorDate, _id: { $gt: cursorId } },
              ],
            };
          }
        } catch {
          return { data: [], hasMore: false };
        }
      }

      const sortDirection = direction === "forward" ? -1 : 1;

      // fetch one extra to determine if there are more results
      const pipeline: PipelineStage[] = [
        { $match: ACTIVE_POST_FILTER },
        ...(Object.keys(cursorFilter).length > 0
          ? [{ $match: cursorFilter }]
          : []),
        { $sort: { createdAt: sortDirection, _id: sortDirection } },
        { $limit: limit + 1 },
        ...getStandardLookups(),
        {
          $project: {
            ...getStandardProjectionFields(),
            _id: 1,
            createdAt: 1,
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      let results = await this.model.aggregate(pipeline).exec();

      // reverse results if backward pagination to maintain consistent order
      if (direction === "backward") {
        results = results.reverse();
      }

      const hasMore = results.length > limit;
      if (hasMore) {
        results = results.slice(0, limit);
      }

      // generate next cursor from last item
      let nextCursor: string | undefined;
      if (hasMore && results.length > 0) {
        const lastItem = results[results.length - 1];
        nextCursor = encodeCursor({
          createdAt: lastItem.createdAt,
          _id: lastItem._id,
        });
      }

      // generate prev cursor from first item (for backward navigation)
      let prevCursor: string | undefined;
      if (options.cursor && results.length > 0) {
        const firstItem = results[0];
        prevCursor = encodeCursor({
          createdAt: firstItem.createdAt,
          _id: firstItem._id,
        });
      }

      // remove internal fields from response
      const data = results.map(({ _id, ...rest }) => rest);

      return { data, hasMore, nextCursor, prevCursor };
    } catch (error: unknown) {
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

      const sinceDate = new Date(
        Date.now() - timeWindowDays * 24 * 60 * 60 * 1000,
      );

      // decode cursor if provided
      let cursorFilter: Record<string, unknown> = {};
      const decodedCursor = decodeCursor<{ trendScore?: number; _id?: string }>(
        options.cursor,
      );
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
          return { data: [], hasMore: false };
        }
      }

      const sortDirection = direction === "forward" ? -1 : 1;
      const feedProjection = getStandardProjectionFields();

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
                        { $subtract: [new Date(), "$createdAt"] },
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
        // apply cursor filtering if provided
        ...(Object.keys(cursorFilter).length > 0
          ? [{ $match: cursorFilter }]
          : []),
        { $sort: { trendScore: sortDirection, _id: sortDirection } },
        { $limit: limit + 1 },
        // populate relationships only on paginated results
        ...getStandardLookups(),
        {
          $project: {
            ...feedProjection,
            _id: 1,
            trendScore: 1,
            createdAt: 1,
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      let results = await this.model.aggregate(pipeline).exec();

      // reverse if backward pagination
      if (direction === "backward") {
        results = results.reverse();
      }

      const hasMore = results.length > limit;
      if (hasMore) {
        results = results.slice(0, limit);
      }

      // generate next cursor
      let nextCursor: string | undefined;
      if (hasMore && results.length > 0) {
        const lastItem = results[results.length - 1];
        nextCursor = encodeCursor({
          trendScore: lastItem.trendScore,
          _id: lastItem._id,
        });
      }

      // generate prev cursor
      let prevCursor: string | undefined;
      if (options.cursor && results.length > 0) {
        const firstItem = results[0];
        prevCursor = encodeCursor({
          trendScore: firstItem.trendScore,
          _id: firstItem._id,
        });
      }

      const data = results.map(({ _id, ...rest }) => rest);
      return { data, hasMore, nextCursor, prevCursor };
    } catch (error: unknown) {
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

      const recentThresholdDays = 90;
      const sinceDate = new Date(
        Date.now() - recentThresholdDays * 24 * 60 * 60 * 1000,
      );
      const favoriteTagIds = await this.loadFavoriteTagIds(favoriteTags);
      const hasTagPreferences = favoriteTagIds.length > 0;

      // decode cursor if provided
      let cursorFilter: Record<string, unknown> = {};
      const decodedCursor = decodeCursor<{ rankScore?: number; _id?: string }>(
        options.cursor,
      );
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
          return { data: [], hasMore: false };
        }
      }

      const sortDirection = direction === "forward" ? -1 : 1;
      const feedProjection = getStandardProjectionFields();

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
                        { $subtract: [new Date(), "$createdAt"] },
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
        // apply cursor filtering if provided
        ...(Object.keys(cursorFilter).length > 0
          ? [{ $match: cursorFilter }]
          : []),
        { $sort: { rankScore: sortDirection, _id: sortDirection } },
        { $limit: limit + 1 },
        // populate relationships only on paginated results
        ...getStandardLookups(),
        {
          $project: {
            ...feedProjection,
            _id: 1,
            rankScore: 1,
            createdAt: 1,
            viewsCount: { $ifNull: ["$viewsCount", 0] },
          },
        },
      ];

      let results = await this.model.aggregate(pipeline).exec();

      // reverse if backward pagination
      if (direction === "backward") {
        results = results.reverse();
      }

      const hasMore = results.length > limit;
      if (hasMore) {
        results = results.slice(0, limit);
      }

      // generate next cursor
      let nextCursor: string | undefined;
      if (hasMore && results.length > 0) {
        const lastItem = results[results.length - 1];
        nextCursor = encodeCursor({
          rankScore: lastItem.rankScore,
          _id: lastItem._id,
        });
      }

      // generate prev cursor
      let prevCursor: string | undefined;
      if (options.cursor && results.length > 0) {
        const firstItem = results[0];
        prevCursor = encodeCursor({
          rankScore: firstItem.rankScore,
          _id: firstItem._id,
        });
      }

      const data = results.map(({ _id, ...rest }) => rest);
      return { data, hasMore, nextCursor, prevCursor };
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build cursor-paginated ranked feed",
      );
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
