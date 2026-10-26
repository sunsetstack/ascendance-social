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
  MAX_FEED_CURSOR_SNAPSHOT_ITEMS,
} from "@/utils/feedCursor";
import {
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjectionFields,
  normalizeObjectId,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";
import {
  buildCreatedAtCursorFilter,
  buildNewFeedPipeline,
  buildSnapshotHydrationPipeline,
  buildTrendingSnapshotPipeline,
  getVisibleIdentityStages,
} from "@/repositories/feed-pipeline.helpers";
import { RedisService } from "@/services/redis.service";
import type { FeedPreviewDefinition } from "@/types/customFeeds/feed-preview.types";
import { INTEREST_POLICY_VERSION, type ContentFeatures, type InterestFeedDefinition } from "@/services/feed/interests.policy";
import { buildInterestScoreStages, INTEREST_FORMAT_PRIOR, interestFormatShares, interestRankingReason, mixInterestFormats, topicAffinities } from "@/services/feed/interest-ranking.policy";
import type { InterestRankBreakdown } from "@/services/feed/interest-ranking.policy";
import { traceFeed } from "@/services/feed/feed-trace";
import {
  buildTrendingScoreStages,
  resolveTrendingScoreWeights,
} from "@/services/feed/trending-score.policy";

type ProjectedFeedPost = FeedPost & {
  _id?: mongoose.Types.ObjectId;
  visibleIdentityId?: mongoose.Types.ObjectId;
};

const INTEREST_CURSOR_SCOPE_VERSION = 1;

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

  async getFollowingFeedWithCursor(
    viewerMongoId: string,
    followingIds: string[],
    options: CursorPaginationOptions,
  ): Promise<CursorPaginationResult<FeedPost>> {
    try {
      const order = FEED_CURSOR_ORDER.PREVIEW_LATEST;
      const authors = [...new Set(followingIds)].sort();
      const eligibility = { user: { $in: this.toObjectIds(authors) } };
      const scope = hashFeedCursorScope(["following-v1", viewerMongoId, authors]);
      const decoded = options.cursor
        ? decodeFeedCursor<"preview", FeedCursorOrder>(options.cursor, { feed: "preview", orders: [order], source: "mongo" })
        : null;
      if (decoded && decoded.scope !== scope) throw Errors.validation("Following changed. Refresh this feed.");
      if (!authors.length) return { data: [], hasMore: false };
      const snapshotRef = decoded
        ? { id: decoded.snapshotId, snapshot: await this.redisService.requireFeedCursorSnapshot(decoded.snapshotId, {
          feed: "preview", order, source: "mongo", scope,
        }) }
        : await this.redisService.getOrCreateFeedCursorSnapshot(scope, async () => {
          const entries = await this.model.aggregate<{
            _id: mongoose.Types.ObjectId; publicId: string; visibleIdentityId: mongoose.Types.ObjectId; rankScore: number;
          }>([
            { $match: withActivePostFilter(eligibility) },
            { $sort: { createdAt: -1, _id: -1 } },
            ...getVisibleIdentityStages(),
            { $sort: { createdAt: -1, _id: -1 } },
            { $limit: MAX_FEED_CURSOR_SNAPSHOT_ITEMS },
            { $project: { _id: 1, publicId: 1, visibleIdentityId: 1, rankScore: { $toLong: "$createdAt" } } },
          ]).exec();
          return this.buildScoreSnapshot("preview", order, entries, "rankScore", scope);
        });
      const page = await this.readScoreSnapshotPage(snapshotRef.snapshot, decoded?.offset ?? 0,
        options.limit ?? 20, "rankScore", eligibility, viewerMongoId);
      return { data: page.data, hasMore: page.hasMore,
        nextCursor: page.hasMore ? encodeFeedCursor({ feed: "preview", order, source: "mongo", scope,
          snapshotId: snapshotRef.id, offset: page.nextOffset }) : undefined };
    } catch (error) {
      if (isAppError(error)) throw error;
      throw Errors.database("Failed to load following feed", { cause: error });
    }
  }

  async getPreviewFeedWithCursor(
    definition: FeedPreviewDefinition,
    options: CursorPaginationOptions,
  ): Promise<FeedSnapshotPaginationResult<FeedPost>> {
    try {
      const limit = options.limit ?? 20;
      const topics = [...new Set(definition.topics.map((topic) => topic.toLowerCase()))].sort();
      const topicIds = await this.loadFavoriteTagIds(topics);
      const eligibility: Record<string, unknown> = {
        ...(topics.length ? { tags: { $in: topicIds } } : {}),
        ...(!definition.includeReposts
          ? { type: { $ne: "repost" }, repostOf: null }
          : {}),
      };
      const order = definition.sort === "latest"
        ? FEED_CURSOR_ORDER.PREVIEW_LATEST
        : FEED_CURSOR_ORDER.PREVIEW_RELEVANT;
      const scope = hashFeedCursorScope([
        "preview-v1", topics, definition.sort, definition.includeReposts,
      ]);
      const decoded = options.cursor
        ? decodeFeedCursor(options.cursor, { feed: "preview", orders: [order], source: "mongo" })
        : null;
      if (decoded && decoded.scope !== scope) {
        throw Errors.validation("Feed cursor does not match these preview settings");
      }

      const snapshotRef = decoded
        ? {
            id: decoded.snapshotId,
            snapshot: await this.redisService.requireFeedCursorSnapshot(decoded.snapshotId, {
              feed: "preview", order, source: "mongo", scope,
            }),
          }
        : await this.redisService.getOrCreateFeedCursorSnapshot(scope, async () => {
            const scoreStages: PipelineStage[] = definition.sort === "latest"
              ? [{ $addFields: { rankScore: { $toLong: "$createdAt" } } }]
              : this.getRankScoreStages(new Date(), topicIds, topicIds.length > 0, {
                  recency: 0.5, popularity: 0.3, tagMatch: 0.2,
                });
            const entries = await this.model.aggregate<{
              _id: mongoose.Types.ObjectId;
              publicId: string;
              visibleIdentityId: mongoose.Types.ObjectId;
              rankScore: number;
            }>([
              { $match: withActivePostFilter(eligibility) },
              ...scoreStages,
              { $sort: { rankScore: -1, _id: -1 } },
              ...getVisibleIdentityStages(),
              { $sort: { rankScore: -1, _id: -1 } },
              { $limit: MAX_FEED_CURSOR_SNAPSHOT_ITEMS },
              { $project: { _id: 1, publicId: 1, visibleIdentityId: 1, rankScore: 1 } },
            ]).exec();
            return this.buildScoreSnapshot("preview", order, entries, "rankScore", scope);
          });

      const page = await this.readScoreSnapshotPage(
        snapshotRef.snapshot, decoded?.offset ?? 0, limit, "rankScore", eligibility,
      );
      return {
        data: page.data,
        hasMore: page.hasMore,
        nextCursor: page.hasMore ? encodeFeedCursor({
          feed: "preview", order, source: "mongo", scope,
          snapshotId: snapshotRef.id, offset: page.nextOffset,
        }) : undefined,
        snapshotId: snapshotRef.id,
        consumedOffset: page.nextOffset,
      };
    } catch (error) {
      if (isAppError(error)) throw error;
      throw Errors.database("Failed to load feed preview", { cause: error });
    }
  }

  async getInterestFeedWithCursor(
    definition: InterestFeedDefinition,
    options: CursorPaginationOptions,
  ): Promise<FeedSnapshotPaginationResult<FeedPost>> {
    const limit = options.limit ?? 20;
    const topics = [...new Set(definition.topics)].sort();
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 86_400_000);
    const eligibility = {
      ...(topics.length ? { "contentFeatures.topics.id": { $in: topics } } : {}),
      ...(definition.sort === "top" ? { createdAt: { $gte: weekStart } } : {}),
    };
    const feed = definition.sort === "personalized" ? (definition.destination === "home" ? "personalized" : "for-you") : "preview";
    const order = feed === "personalized" ? FEED_CURSOR_ORDER.PERSONALIZED_RANKED : feed === "for-you" ? FEED_CURSOR_ORDER.FOR_YOU
      : definition.sort === "newest" ? FEED_CURSOR_ORDER.PREVIEW_LATEST : FEED_CURSOR_ORDER.PREVIEW_RELEVANT;
    const scope = hashFeedCursorScope(["interests-explained-v1", INTEREST_CURSOR_SCOPE_VERSION, feed, topics, definition.sort, definition.viewer ?? "guest"]);
    traceFeed("feed.rank.requested", { destination: feed, topics, sort: definition.sort,
      continuation: Boolean(options.cursor), profileRevision: definition.profile?.revision });
    const decoded = options.cursor ? decodeFeedCursor(options.cursor, { feed, orders: [order], source: "mongo" }) : null;
    if (decoded && decoded.scope !== scope) throw Errors.validation("Feed cursor does not match these interests");
    let built = false;
    const snapshotRef = decoded ? {
      id: decoded.snapshotId,
      snapshot: await this.redisService.requireFeedCursorSnapshot(decoded.snapshotId, { feed, order, source: "mongo", scope }),
    } : await this.redisService.getOrCreateFeedCursorSnapshot(
      hashFeedCursorScope([scope, INTEREST_POLICY_VERSION, definition.profile?.revision ?? 0, "rank-breakdown-topic-format-mix-v1"]),
      async () => {
        built = true;
        traceFeed("feed.rank.build.started", { destination: feed, scope, asOf: now.toISOString(), profile: definition.profile,
          topicAffinities: Object.fromEntries(topicAffinities(definition.profile)) });
        const scoreStages: PipelineStage[] = definition.sort === "newest"
          ? [{ $addFields: { rankScore: { $toLong: "$createdAt" } } }]
          : definition.sort === "top"
            ? [{ $addFields: { rankScore: { $add: [{ $ifNull: ["$likesCount", 0] }, { $multiply: [2, { $ifNull: ["$repostCount", 0] }] }] } } }]
            : buildInterestScoreStages(definition.profile, now);
        const formatShares = definition.sort === "personalized" ? interestFormatShares(definition.profile) : undefined;
        const candidateStages: PipelineStage[] = formatShares ? [
          { $setWindowFields: { partitionBy: "$contentFeatures.format", sortBy: { rankScore: -1, _id: -1 }, output: { formatRank: { $sum: 1, window: { documents: ["unbounded", "current"] } } } } },
          { $match: { formatRank: { $lte: MAX_FEED_CURSOR_SNAPSHOT_ITEMS } } },
          { $sort: { rankScore: -1, _id: -1 } },
        ] : [{ $sort: { rankScore: -1, _id: -1 } }, { $limit: MAX_FEED_CURSOR_SNAPSHOT_ITEMS }];
        const entries = await this.model.aggregate<{
          _id: mongoose.Types.ObjectId; publicId: string; visibleIdentityId: mongoose.Types.ObjectId; rankScore: number; contentFeatures?: ContentFeatures; rankBreakdown?: InterestRankBreakdown;
        }>([
          { $match: withActivePostFilter(eligibility) },
          ...scoreStages,
          { $sort: { rankScore: -1, _id: -1 } },
          ...getVisibleIdentityStages(),
          ...candidateStages,
          { $project: { _id: 1, publicId: 1, visibleIdentityId: 1, rankScore: 1, contentFeatures: 1, rankBreakdown: 1 } },
        ]).exec();
        const ranked = (formatShares ? mixInterestFormats(entries, formatShares, topicAffinities(definition.profile)) : entries).slice(0, MAX_FEED_CURSOR_SNAPSHOT_ITEMS);
        const snapshot = this.buildScoreSnapshot(feed, order, ranked, "rankScore", scope);
        const basePositions = formatShares ? new Map(entries.map((entry, index) => [entry.publicId, index])) : undefined;
        if (formatShares) traceFeed("feed.format.mix.planned", { destination: feed, scope, formatShares,
          evidence: definition.profile?.formats, priorPerFormat: INTEREST_FORMAT_PRIOR, candidates: entries.length, retained: ranked.length });
        if (definition.sort === "personalized") snapshot.entries.forEach((entry, index) => {
          const candidate = ranked[index];
          entry.reason = interestRankingReason(candidate.contentFeatures, definition.profile);
          entry.rankBreakdown = candidate.rankBreakdown;
          if (formatShares && candidate.contentFeatures && Object.hasOwn(formatShares, candidate.contentFeatures.format)) {
            entry.formatMix = { format: candidate.contentFeatures.format, share: formatShares[candidate.contentFeatures.format], basePosition: basePositions!.get(entry.publicId)! };
          }
        });
        return snapshot;
      },
    );
    traceFeed("feed.snapshot.ready", { destination: feed, snapshotId: snapshotRef.id,
      source: decoded ? "continuation" : built ? "build_attempt" : "reused", entries: snapshotRef.snapshot.entries.length });
    const page = await this.readScoreSnapshotPage(snapshotRef.snapshot, decoded?.offset ?? 0, limit, "rankScore", eligibility, definition.viewerMongoId);
    return {
      data: page.data,
      hasMore: page.hasMore,
      nextCursor: !page.hasMore ? undefined : feed === "preview"
        ? encodeFeedCursor({ feed: "preview", order: definition.sort === "newest" ? FEED_CURSOR_ORDER.PREVIEW_LATEST : FEED_CURSOR_ORDER.PREVIEW_RELEVANT,
            source: "mongo", scope, snapshotId: snapshotRef.id, offset: page.nextOffset })
        : this.buildRankedSnapshotCursor(feed, snapshotRef.id, page.nextOffset, scope),
      snapshotId: snapshotRef.id,
      consumedOffset: page.nextOffset,
    };
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
      const weights = resolveTrendingScoreWeights(options?.weights);

      const asOf = new Date();
      const sinceDate = new Date(
        asOf.getTime() - timeWindowDays * 24 * 60 * 60 * 1000,
      );

      const pipeline: PipelineStage[] = [
        {
          $match: withActivePostFilter({
            createdAt: { $gte: sinceDate },
            likesCount: { $gte: minLikes },
          }),
        },
        // compute trend scores before $lookup to sort/paginate early
        ...buildTrendingScoreStages(asOf, weights),
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
      const cursorFilter = buildCreatedAtCursorFilter(
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

      const pipeline = buildNewFeedPipeline(limit, direction, cursorFilter, seenIdentityIds);

      let results = await this.model.aggregate(pipeline).exec();

      const hasMore = results.length > limit;
      if (hasMore) {
        results = results.slice(0, limit);
      }

      if (direction === "backward") {
        results = results.reverse();
      }

      const nextCursor =
        hasMore && results.length > 0
          ? this.buildNewCursor(
              results,
              decodedCursor,
              direction === "backward" ? 0 : results.length - 1,
            )
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
      if (isAppError(error)) throw error;
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
      const weights = resolveTrendingScoreWeights(options.weights);
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
              const entries = await this.model
                .aggregate<{
                  _id: mongoose.Types.ObjectId;
                  publicId: string;
                  visibleIdentityId: mongoose.Types.ObjectId;
                  trendScore: number;
                }>(buildTrendingSnapshotPipeline(asOf, timeWindowDays, minLikes, weights))
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
      if (isAppError(error)) throw error;
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to build cursor-paginated trending feed",
      );
    }
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
    feed: "for-you" | "personalized" | "trending" | "preview",
    order: FeedCursorOrder,
    results: Array<{
      _id: mongoose.Types.ObjectId;
      publicId: string;
      visibleIdentityId: mongoose.Types.ObjectId;
    } & Record<string, unknown>>,
    scoreField: "rankScore" | "trendScore",
    scope?: string,
  ): FeedCursorSnapshot {
    if (results.length > MAX_FEED_CURSOR_SNAPSHOT_ITEMS) {
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
    eligibility: Record<string, unknown> = {},
    viewerMongoId?: string,
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
        .aggregate<ProjectedFeedPost>(buildSnapshotHydrationPipeline(
          objectIds,
          limit + 1 - collected.length,
          eligibility,
          viewerMongoId,
        ))
        .exec();
      const byId = new Map(posts.map((post) => [String(post._id), post]));

      for (let index = 0; index < batch.length; index += 1) {
        const entry = batch[index];
        const post = byId.get(entry._id);
        if (!post) continue;
        (post as ProjectedFeedPost & Record<string, unknown>)[scoreField] =
          entry.score;
        if (entry.reason) post.feedReason = entry.reason;
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
    for (const { entry, post, index } of visible) traceFeed("feed.rank.served", {
      destination: snapshot.feed, scope: snapshot.scope, position: index, postPublicId: entry.publicId,
      score: entry.score, reason: entry.reason, rankBreakdown: entry.rankBreakdown,
      formatMix: entry.formatMix,
      classification: post.contentFeatures ? {
        version: post.contentFeatures.version,
        topics: post.contentFeatures.topics.map((topic) => ({ id: topic.id, weight: topic.weight })),
        format: post.contentFeatures.format,
      } : undefined, isLikedByViewer: post.isLikedByViewer,
      isRepostedByViewer: post.isRepostedByViewer,
    });
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
