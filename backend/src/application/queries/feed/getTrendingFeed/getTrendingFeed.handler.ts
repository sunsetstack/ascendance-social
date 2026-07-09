import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetTrendingFeedQuery } from "./getTrendingFeed.query";
import type {
  IPostReadRepository,
  IFeedReadDao,
} from "@/repositories/interfaces";
import { RedisService } from "@/services/redis.service";
import { Errors } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";
import { FeedPost, PaginatedFeedResult } from "@/types";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { asPostPublicId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";

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
      // Always try cursor-based pagination (Redis or DB)
      // If cursor is undefined, it fetches the first page
      redisLogger.debug("Using cursor-based trending feed strategy");

      let isNewPhase = false;
      let actualCursor = cursor;
      if (cursor?.startsWith("new_phase:")) {
        isNewPhase = true;
        actualCursor = cursor.replace("new_phase:", "");
      }

      if (isNewPhase) {
        const result = await this.feedReadDao.getNewFeedWithCursor({
          limit,
          cursor: actualCursor,
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
            ? `new_phase:${result.nextCursor}`
            : undefined,
          hasMore: result.hasMore,
        };
      }

      // Try Redis ZSET first
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

          // Re-sort to match Redis order
          const postMap = new Map(posts.map((p) => [p.publicId, p]));
          const orderedPosts = redisResult.ids
            .map((id) => postMap.get(id))
            .filter((p): p is FeedPost => p !== undefined);

          const transformedPosts = normalizeFeedPosts(orderedPosts);
          const enriched =
            await this.feedEnrichmentService.enrichFeedWithCurrentData(
              transformedPosts,
            );

          return {
            data: enriched,
            page: page, // keep page for backward compat in response structure
            limit,
            total: 0,
            totalPages: 0,
            nextCursor: redisResult.nextCursor,
            hasMore: redisResult.hasMore,
          };
        }
      } catch (err) {
        redisLogger.warn(
          "Failed to get trending feed from Redis, falling back to DB",
          { error: err },
        );
      }

      // Fallback to DB cursor pagination
      redisLogger.info(
        "Falling back to DB cursor pagination for trending feed",
      );
      let result = await this.feedReadDao.getTrendingFeedWithCursor({
        limit,
        cursor: actualCursor,
        timeWindowDays: 30,
        minLikes: 1,
      });

      let transformedPosts = normalizeFeedPosts(result.data);
      let nextCursor = result.nextCursor;
      let hasMore = result.hasMore;

      // When trending content is exhausted, transition to chronological (new) feed
      if (!hasMore) {
        const needed = limit - transformedPosts.length;
        if (needed > 0) {
          // Current page isn't full backfill the remainder with new posts
          const backfill = await this.feedReadDao.getNewFeedWithCursor({
            limit: needed + 1,
          });
          const existingIds = new Set(transformedPosts.map((p) => p.publicId));

          const uniqueBackfill = backfill.data.filter(
            (p) => !existingIds.has(p.publicId),
          );
          const mappedBackfill = normalizeFeedPosts(uniqueBackfill);

          transformedPosts = [...transformedPosts, ...mappedBackfill];
          nextCursor = backfill.nextCursor
            ? `new_phase:${backfill.nextCursor}`
            : undefined;
          hasMore = backfill.hasMore;
        } else {
          // Current page is full with trending posts, but there are no more trending posts.
          // Fetch a single new feed page so we can generate the new_phase cursor for the NEXT request.
          const backfill = await this.feedReadDao.getNewFeedWithCursor({
            limit: limit + 1,
          });
          nextCursor = backfill.nextCursor
            ? `new_phase:${backfill.nextCursor}`
            : undefined;
          hasMore = backfill.data.length > 0;
        }
      }

      // Ensure we respect the limit
      if (transformedPosts.length > limit) {
        transformedPosts = transformedPosts.slice(0, limit);
        hasMore = true;
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
        nextCursor,
        hasMore,
      };
    } catch (error) {
      redisLogger.error("Trending feed error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw Errors.internal("Could not generate trending feed.");
    }
  }

}
