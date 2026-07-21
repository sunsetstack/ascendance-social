import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetForYouFeedQuery } from "./getForYouFeed.query";
import type {
  IPostReadRepository,
  IUserReadRepository,
  IFeedReadDao,
} from "@/repositories/interfaces";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { RedisService } from "@/services/redis.service";
import { Errors, isAppError } from "@/utils/errors";
import { errorLogger, redisLogger } from "@/utils/winston";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { FeedPost, PaginatedFeedResult } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import {
  decodeFeedCursor,
  FEED_CURSOR_ORDER,
} from "@/utils/feedCursor";

@injectable()
export class GetForYouFeedQueryHandler implements IQueryHandler<
  GetForYouFeedQuery,
  PaginatedFeedResult
> {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.PostRead)
    private postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Services.FeedEnrichment)
    private feedEnrichmentService: FeedEnrichmentService,
  ) {}

  async execute(query: GetForYouFeedQuery): Promise<PaginatedFeedResult> {
    const { userId, page, limit, cursor } = query;
    redisLogger.info(`getForYouFeed called`, {
      userId,
      page,
      limit,
      hasCursor: !!cursor,
    });

    try {
      const decodedCursor = cursor
        ? decodeFeedCursor(cursor, {
            feed: "for-you",
            orders: [FEED_CURSOR_ORDER.FOR_YOU],
          })
        : null;

      if (!decodedCursor || decodedCursor.source === "redis") {
        try {
          const redisResult = await this.redisService.getFeedWithCursor(
            userId,
            limit,
            cursor,
            "for_you",
          );

          if (redisResult.ids.length > 0) {
            redisLogger.info(`For You feed ZSET HIT`, {
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
            return {
              data: [],
              page,
              limit,
              total: 0,
              totalPages: 0,
              hasMore: false,
            };
          }
        } catch (error) {
          if (isAppError(error)) throw error;
          redisLogger.warn("Failed to get feed from Redis cursor", {
            error,
          });
        }
      }

      // 2. Cache Miss - Generate from DB using Cursor Pagination
      redisLogger.info(`For You feed ZSET MISS, generating from DB`, {
        userId,
      });

      const user = await this.userReadRepository.findByPublicId(
        asUserPublicId(userId),
      );
      if (!user) {
        throw Errors.notFound("User");
      }
      const topTags = await this.userPreferenceRepository.getTopUserTags(
        String(user._id),
      );
      const favoriteTags = topTags.map((pref) => pref.tag);
      const result = await this.feedReadDao.getRankedFeedWithCursor(
        favoriteTags,
        { limit, cursor },
      );
      const transformedFeedData = normalizeFeedPosts(result.data);

      // 3. Populate Redis ZSET (Fire-and-forget)
      // Only populate if we are on the first page (no cursor) to avoid fragmented cache
      if (!cursor && transformedFeedData.length > 0) {
        const timestamp = Date.now();
        redisLogger.info(`Populating ZSET for user`, {
          userId,
          postCount: transformedFeedData.length,
        });

        Promise.all(
          transformedFeedData.map((post: FeedPost, idx: number) => {
            // score = now - idx (so first item has highest score)
            return this.redisService.addToFeed(
              userId,
              post.publicId,
              timestamp - idx,
              "for_you",
            );
          }),
        ).catch((err) => {
          errorLogger.error(`Failed to populate For You feed ZSET`, {
            userId,
            error: err.message,
          });
        });
      }

      const enriched =
        await this.feedEnrichmentService.enrichFeedWithCurrentData(
          transformedFeedData,
        );

      return {
        data: enriched,
        page,
        limit,
        total: 0,
        totalPages: 0,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    } catch (error) {
      if (isAppError(error)) throw error;
      errorLogger.error("For You feed error", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw Errors.internal("Could not generate For You feed.");
    }
  }

}
