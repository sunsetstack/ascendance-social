import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetPersonalizedFeedQuery } from "./getPersonalizedFeed.query";
import { RedisService } from "@/services/redis.service";
import { Errors, isAppError } from "@/utils/errors";
import { CursorPaginationResult, FeedPost } from "@/types";
import { logger } from "@/utils/winston";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { FeedCoreService } from "@/services/feed/feed-core.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";
import { decodeFeedCursor, FEED_CURSOR_ORDER } from "@/utils/feedCursor";

@injectable()
export class GetPersonalizedFeedQueryHandler implements IQueryHandler<
  GetPersonalizedFeedQuery,
  any
> {
  constructor(
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Services.FeedEnrichment)
    private feedEnrichmentService: FeedEnrichmentService,
    @inject(TOKENS.Services.FeedCore)
    private readonly feedCoreService: FeedCoreService,
  ) {}

  async execute(
    query: GetPersonalizedFeedQuery,
  ): Promise<CursorPaginationResult<FeedPost>> {
    const { userId, limit, cursor } = query;
    logger.info(
      `Running cursor-based getPersonalizedFeed for userId: ${userId}`,
    );
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit || 20)));

    try {
      if (cursor) {
        decodeFeedCursor(cursor, {
          feed: "personalized",
          orders: [
            FEED_CURSOR_ORDER.PERSONALIZED,
            FEED_CURSOR_ORDER.PERSONALIZED_RANKED,
          ],
          source: "mongo",
        });
      }
      const coreFeedKey = CacheKeyBuilder.getPersonalizedCursorFeedKey(
        userId,
        cursor,
        safeLimit,
      );
      let coreFeed = (await this.redisService.getWithTags(
        coreFeedKey,
      )) as CursorPaginationResult<any> | null;

      if (!coreFeed) {
        // cache miss - generate core feed
        logger.info("Core feed cache miss, generating...");
        coreFeed = await this.feedCoreService.generatePersonalizedCoreFeed(
          asUserPublicId(userId),
          safeLimit,
          cursor,
        );

        // store in redis with tags for smart invalidation
        const tags = [
          CacheKeyBuilder.getUserFeedTag(userId),
          CacheKeyBuilder.getFeedLimitTag(safeLimit),
        ];
        await this.redisService.setWithTags(coreFeedKey, coreFeed, tags, 300); // 5 minutes
      } else {
        logger.info("Core feed cache hit");
      }

      // Enrich core feed with fresh user data
      const enrichedData: FeedPost[] =
        await this.feedEnrichmentService.enrichFeedWithCurrentData(
          coreFeed.data,
        );

      return {
        data: enrichedData,
        hasMore: coreFeed.hasMore,
        nextCursor: coreFeed.nextCursor,
        prevCursor: coreFeed.prevCursor,
      };
    } catch (error) {
      if (isAppError(error)) throw error;
      logger.error("Failed to generate personalized feed", { error });
      throw Errors.internal(
        `Could not generate personalized feed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
