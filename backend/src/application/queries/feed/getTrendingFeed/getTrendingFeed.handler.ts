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
  FeedCursorPayload,
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
                decodedCursor,
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
      const mongoCursor =
        decodedCursor?.source === "redis"
          ? await this.translateRedisCursor(decodedCursor)
          : cursor;
      const result = await this.feedReadDao.getTrendingFeedWithCursor({
        limit,
        cursor: mongoCursor,
        timeWindowDays: 30,
        minLikes: 1,
      });
      const transformedPosts = normalizeFeedPosts(result.data);
      if (!result.hasMore) {
        return this.completeWithNewFeed(
          transformedPosts,
          decodedCursor,
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
    cursor: FeedCursorPayload | null,
    page: number,
    limit: number,
  ): Promise<PaginatedFeedResult> {
    const seenPublicIds = [
      ...new Set([
        ...(cursor?.seenPublicIds ?? []),
        ...trendingPosts.map(
          (post) => post.repostOf?.publicId ?? post.publicId,
        ),
      ]),
    ];
    const seen = await this.resolveVisibleInternalIds(seenPublicIds);
    const newStartCursor =
      seen.length > 0 || seenPublicIds.length > 0
        ? encodeFeedCursor({
            feed: "new",
            order: FEED_CURSOR_ORDER.NEW,
            source: "mongo",
            phase: "new",
            seen,
            seenPublicIds,
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

  private async translateRedisCursor(
    cursor: FeedCursorPayload,
  ): Promise<string> {
    const seenPublicIds = cursor.seenPublicIds ?? [];
    return encodeFeedCursor({
      feed: "trending",
      order: FEED_CURSOR_ORDER.TRENDING,
      source: "mongo",
      phase: "trending",
      asOf: new Date().toISOString(),
      seen: await this.resolveVisibleInternalIds(seenPublicIds),
      seenPublicIds,
    });
  }

  private async resolveVisibleInternalIds(
    publicIds: string[],
  ): Promise<string[]> {
    const ids = await Promise.all(
      publicIds.map((publicId) =>
        this.postReadRepository.findInternalIdByPublicId(
          asPostPublicId(publicId),
        ),
      ),
    );
    return ids.filter((id): id is NonNullable<typeof id> => id !== null).map(String);
  }

  private toNewCursor(cursor: FeedCursorPayload): string {
    return encodeFeedCursor({
      ...cursor,
      feed: "new",
      order: FEED_CURSOR_ORDER.NEW,
      source: "mongo",
      phase: "new",
    });
  }

  private toTrendingNewCursor(newCursor: string): string {
    const decoded = decodeFeedCursor(newCursor, {
      feed: "new",
      orders: [FEED_CURSOR_ORDER.NEW],
      source: "mongo",
    });
    return encodeTrendingNewCursor({
      ...decoded,
      feed: "trending",
      order: FEED_CURSOR_ORDER.TRENDING_NEW,
      source: "mongo",
      phase: "new",
    });
  }

}
