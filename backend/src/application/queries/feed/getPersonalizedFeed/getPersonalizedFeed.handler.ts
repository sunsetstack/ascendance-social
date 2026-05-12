import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetPersonalizedFeedQuery } from "./getPersonalizedFeed.query";
import { RedisService } from "@/services/redis.service";
import { Errors } from "@/utils/errors";
import { CursorPaginationResult, FeedPost } from "@/types";
import { logger } from "@/utils/winston";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { FeedCoreService } from "@/services/feed/feed-core.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

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
      // Get core feed structure (post IDs and order)
      let cacheKeyArgs = cursor ? cursor : "first_page";
      const coreFeedKey = `${CacheKeyBuilder.PREFIXES.CORE_FEED}:cursor:${userId}:${cacheKeyArgs}:${safeLimit}`;
      let coreFeed = (await this.redisService.getWithTags(
        coreFeedKey,
      )) as CursorPaginationResult<any> | null;

      if (!coreFeed) {
        // cache miss - generate core feed
        logger.info("Core feed cache miss, generating...");
        coreFeed = await this.feedCoreService.generatePersonalizedCoreFeed(
          userId,
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
      console.error("Failed to generate personalized feed:", error);
      throw Errors.internal(
        `Could not generate personalized feed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
