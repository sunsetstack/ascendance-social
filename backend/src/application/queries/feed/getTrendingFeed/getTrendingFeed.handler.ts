import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetTrendingFeedQuery } from "./getTrendingFeed.query";
import type {
  IPostReadRepository,
  IFeedReadDao,
} from "@/repositories/interfaces";
import { RedisService } from "@/services/redis.service";
import { Errors, isAppError } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";
import { FeedPost, PaginatedFeedResult } from "@/types";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { asPostPublicId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  encodeTrendingNewCursor,
  FEED_CURSOR_ORDER,
  hashFeedCursorScope,
  TrendingNewFeedCursorPayload,
} from "@/utils/feedCursor";

@injectable()
export class GetTrendingFeedQueryHandler implements IQueryHandler<
  GetTrendingFeedQuery,
  PaginatedFeedResult
> {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.PostRead)
    private postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Services.FeedEnrichment)
    private feedEnrichmentService: FeedEnrichmentService,
  ) {}

  async execute(query: GetTrendingFeedQuery): Promise<PaginatedFeedResult> {
    const { page, limit, cursor } = query;
    redisLogger.info(`getTrendingFeed called`, {
      page,
      limit,
      hasCursor: !!cursor,
    });

    try {
      const decodedCursor = cursor
        ? decodeFeedCursor(cursor, {
            feed: "trending",
            orders: [
              FEED_CURSOR_ORDER.TRENDING,
              FEED_CURSOR_ORDER.TRENDING_NEW,
            ],
          })
        : null;

      if (decodedCursor?.phase === "new") {
        const result = await this.feedReadDao.getNewFeedWithCursor({
          limit,
          cursor: this.toNewCursor(decodedCursor),
        });
        const transformedPosts = normalizeFeedPosts(result.data);
        const enriched =
          await this.feedEnrichmentService.enrichFeedWithCurrentData(
            transformedPosts,
          );

        return {
          data: enriched,
          page: page,
          limit,
          total: 0,
          totalPages: 0,
          nextCursor: result.nextCursor
            ? this.toTrendingNewCursor(result.nextCursor)
            : undefined,
          hasMore: result.hasMore,
        };
      }

      if (!decodedCursor || decodedCursor.source === "redis") {
        try {
          const redisResult = await this.redisService.getTrendingFeedWithCursor(
            limit,
            cursor,
          );
          if (redisResult.ids.length > 0) {
            redisLogger.info(`Trending feed ZSET HIT`, {
              count: redisResult.ids.length,
            });
            const posts = await this.postReadRepository.findPostsByPublicIds(
              redisResult.ids.map(asPostPublicId),
            );

            const postMap = new Map(posts.map((p) => [p.publicId, p]));
            const orderedPosts = redisResult.ids
              .map((id) => postMap.get(id))
              .filter((p): p is FeedPost => p !== undefined);

            const transformedPosts = normalizeFeedPosts(orderedPosts);
            if (!redisResult.hasMore) {
              return this.completeWithNewFeed(
                transformedPosts,
                redisResult.snapshotId,
                redisResult.consumedOffset,
                page,
                limit,
              );
            }
            const enriched =
              await this.feedEnrichmentService.enrichFeedWithCurrentData(
                transformedPosts,
              );

            return {
              data: enriched,
              page,
              limit,
              total: 0,
              totalPages: 0,
              nextCursor: redisResult.nextCursor,
              hasMore: redisResult.hasMore,
            };
          }
          if (decodedCursor?.source === "redis") {
            return this.completeWithNewFeed(
              [],
              decodedCursor.snapshotId,
              decodedCursor.offset,
              page,
              limit,
            );
          }
        } catch (error) {
          if (isAppError(error) && error.statusCode === 400) throw error;
          redisLogger.warn(
            "Failed to get trending feed from Redis, falling back to DB",
            { error },
          );
        }
      }

      redisLogger.info(
        "Falling back to DB cursor pagination for trending feed",
      );
      const result = await this.feedReadDao.getTrendingFeedWithCursor({
        limit,
        cursor,
        timeWindowDays: 30,
        minLikes: 1,
      });
      const transformedPosts = normalizeFeedPosts(result.data);
      if (!result.hasMore) {
        return this.completeWithNewFeed(
          transformedPosts,
          result.snapshotId,
          result.consumedOffset,
          page,
          limit,
        );
      }

      const enriched =
        await this.feedEnrichmentService.enrichFeedWithCurrentData(
          transformedPosts,
        );

      return {
        data: enriched,
        page: page,
        limit,
        total: 0,
        totalPages: 0,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    } catch (error) {
      if (isAppError(error) && error.statusCode === 400) throw error;
      redisLogger.error("Trending feed error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw Errors.internal("Could not generate trending feed.");
    }
  }

  private async completeWithNewFeed(
    trendingPosts: FeedPost[],
    snapshotId: string | undefined,
    consumedOffset: number | undefined,
    page: number,
    limit: number,
  ): Promise<PaginatedFeedResult> {
    const seen = await this.collectVisibleInternalIds(
      snapshotId,
      consumedOffset,
      trendingPosts,
    );
    const exclusionSnapshot =
      seen.length > 0
        ? await this.redisService.getOrCreateFeedCursorSnapshot(
            `new-feed-exclusions:${hashFeedCursorScope([...seen].sort())}`,
            async () => ({
              version: 1,
              feed: "new",
              order: FEED_CURSOR_ORDER.NEW,
              source: "mongo",
              entries: [],
              excludedIdentityIds: [...new Set(seen)],
            }),
          )
        : null;
    const newStartCursor =
      exclusionSnapshot
        ? encodeFeedCursor({
            feed: "new",
            order: FEED_CURSOR_ORDER.NEW,
            source: "mongo",
            phase: "new",
            snapshotId: exclusionSnapshot.id,
          })
        : undefined;
    const needed = limit - trendingPosts.length;

    let data = trendingPosts;
    let hasMore = false;
    let nextCursor: string | undefined;
    if (needed > 0) {
      const backfill = await this.feedReadDao.getNewFeedWithCursor({
        limit: needed,
        cursor: newStartCursor,
      });
      data = [...data, ...normalizeFeedPosts(backfill.data)];
      hasMore = backfill.hasMore;
      nextCursor = backfill.nextCursor
        ? this.toTrendingNewCursor(backfill.nextCursor)
        : undefined;
    } else {
      const peek = await this.feedReadDao.getNewFeedWithCursor({
        limit: 1,
        cursor: newStartCursor,
      });
      hasMore = peek.data.length > 0;
      if (hasMore) {
        nextCursor = this.toTrendingNewCursor(newStartCursor!);
      }
    }

    const enriched = await this.feedEnrichmentService.enrichFeedWithCurrentData(
      data,
    );
    return {
      data: enriched,
      page,
      limit,
      total: 0,
      totalPages: 0,
      nextCursor,
      hasMore,
    };
  }

  private async resolveVisibleInternalIds(
    publicIds: string[],
  ): Promise<string[]> {
    return (
      await this.postReadRepository.findInternalIdsByPublicIds(
        [...new Set(publicIds)].map(asPostPublicId),
      )
    ).map(String);
  }

  private async collectVisibleInternalIds(
    snapshotId: string | undefined,
    consumedOffset: number | undefined,
    currentPosts: FeedPost[],
  ): Promise<string[]> {
    const internalIds = new Set<string>();
    const visiblePublicIds = new Set(
      currentPosts.map((post) => post.repostOf?.publicId ?? post.publicId),
    );
    if (snapshotId && consumedOffset !== undefined) {
      const snapshot = await this.redisService.getFeedCursorSnapshot(snapshotId);
      if (!snapshot) {
        throw Errors.validation("Feed cursor snapshot is missing or expired");
      }
      const consumed = snapshot.entries.slice(0, consumedOffset);
      if (snapshot.source === "mongo") {
        for (const entry of consumed) internalIds.add(entry.visibleIdentityId);
      } else {
        const posts = await this.postReadRepository.findPostsByPublicIds(
          consumed.map((entry) => asPostPublicId(entry.publicId)),
        );
        for (const post of posts) {
          visiblePublicIds.add(post.repostOf?.publicId ?? post.publicId);
        }
      }
    }
    for (const id of await this.resolveVisibleInternalIds([...visiblePublicIds])) {
      internalIds.add(id);
    }
    return [...internalIds];
  }

  private toNewCursor(cursor: TrendingNewFeedCursorPayload): string {
    return encodeFeedCursor({
      feed: "new",
      order: FEED_CURSOR_ORDER.NEW,
      source: "mongo",
      phase: "new",
      snapshotId: cursor.snapshotId,
      ...("createdAt" in cursor && cursor.createdAt
        ? { createdAt: cursor.createdAt, _id: cursor._id }
        : {}),
    });
  }

  private toTrendingNewCursor(newCursor: string): string {
    const decoded = decodeFeedCursor(newCursor, {
      feed: "new",
      orders: [FEED_CURSOR_ORDER.NEW],
      source: "mongo",
    });
    return encodeTrendingNewCursor({
      feed: "trending",
      order: FEED_CURSOR_ORDER.TRENDING_NEW,
      source: "mongo",
      phase: "new",
      snapshotId: decoded.snapshotId!,
      ...(decoded.createdAt
        ? { createdAt: decoded.createdAt, _id: decoded._id }
        : {}),
    });
  }

}
