import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetWhoToFollowQuery } from "./getWhoToFollow.query";
import { inject, injectable } from "tsyringe";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { RedisService } from "@/services/redis.service";
import {
  UserActivityService,
  PlatformActivityLevel,
} from "@/services/user-activity.service";
import { Errors, wrapError } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export interface SuggestedUser {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  bio?: string;
  followerCount: number;
  postCount: number;
  totalLikes: number;
  score: number;
}

export interface GetWhoToFollowResult {
  suggestions: SuggestedUser[];
  cached: boolean;
  timestamp: string;
  activityLevel?: PlatformActivityLevel;
}

@injectable()
export class GetWhoToFollowQueryHandler implements IQueryHandler<
  GetWhoToFollowQuery,
  GetWhoToFollowResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Services.UserActivity)
    private readonly userActivityService: UserActivityService,
  ) {}

  async execute(query: GetWhoToFollowQuery): Promise<GetWhoToFollowResult> {
    try {
      const cacheKey = `who_to_follow:${query.userPublicId}:limit:${query.limit}`;
      const tags = ["who_to_follow", `user_suggestions:${query.userPublicId}`];

      // try to get from cache
      const cached =
        await this.redisService.getWithTags<GetWhoToFollowResult>(cacheKey);
      if (cached) {
        logger.info(`[WhoToFollow] Cache hit for user ${query.userPublicId}`);
        return { ...cached, cached: true };
      }

      // get current user's internal ID
      const currentUser = await this.userReadRepository.findByPublicId(
        query.userPublicId,
      );
      if (!currentUser) {
        throw Errors.notFound("User");
      }

      // determine platform activity level to choose strategy
      const activityLevel =
        await this.userActivityService.getPlatformActivityLevel();
      logger.info(`[WhoToFollow] Platform activity level: ${activityLevel}`);

      let suggestions: SuggestedUser[];

      if (activityLevel === "dormant" || activityLevel === "low") {
        // low traffic mode: show any user who has posted
        suggestions = await this.getSuggestionsLowTraffic(
          String(currentUser._id),
          query.limit,
        );
        logger.info(
          `[WhoToFollow] Low traffic mode: found ${suggestions.length} suggestions`,
        );
      } else {
        // high/medium traffic mode: show engaging users
        suggestions = await this.getSuggestionsHighTraffic(
          String(currentUser._id),
          query.limit,
        );
        logger.info(
          `[WhoToFollow] High traffic mode: found ${suggestions.length} suggestions`,
        );

        // fallback to low traffic mode if high traffic returns no results
        if (suggestions.length === 0) {
          logger.info(
            "[WhoToFollow] High traffic mode returned no results, falling back to low traffic",
          );
          suggestions = await this.getSuggestionsLowTraffic(
            String(currentUser._id),
            query.limit,
          );
        }
      }

      const result: GetWhoToFollowResult = {
        suggestions,
        cached: false,
        timestamp: new Date().toISOString(),
        activityLevel,
      };

      // calculate dynamic TTL based on activity
      const ttl = await this.userActivityService.calculateDynamicTTL();
      logger.info(
        `[WhoToFollow] Caching with TTL: ${this.userActivityService.ttlToHuman(ttl)}`,
      );

      await this.redisService.setWithTags(cacheKey, result, tags, ttl);

      logger.info(
        `[WhoToFollow] Generated ${suggestions.length} suggestions for user ${query.userPublicId}`,
      );
      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal("Failed to get user suggestions");
    }
  }

  /**
   * Low traffic strategy: show any user who has posted
   * Uses recently active users from Redis for freshness
   */
  private async getSuggestionsLowTraffic(
    currentUserId: string,
    limit: number,
  ): Promise<SuggestedUser[]> {
    // get recently active users from our tracking
    const recentlyActiveUsers =
      await this.userActivityService.getRecentlyActiveUsers(7);
    logger.info(
      `[WhoToFollow] Found ${recentlyActiveUsers.length} recently active users`,
    );

    return this.userReadRepository.getSuggestedUsersLowTraffic(
      currentUserId,
      limit,
      recentlyActiveUsers,
    );
  }

  /**
   * High traffic strategy: show users with engagement metrics
   */
  private async getSuggestionsHighTraffic(
    currentUserId: string,
    limit: number,
  ): Promise<SuggestedUser[]> {
    return this.userReadRepository.getSuggestedUsersHighTraffic(
      currentUserId,
      limit,
    );
  }
}
