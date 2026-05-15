import { UserPublicId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import { RedisService } from "./redis.service";
import {
  AdaptiveTTL,
  ActivityThresholds,
  PlatformSizeThresholds,
} from "@/config/cacheConfig";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export const USER_ACTIVITY_METRICS_KEY = "who_to_follow:activity_metrics";

export interface UserActivityMetrics {
  postCount: number;
  lastUpdated: number;
  recentPostCount: number;
  recentWindowStart: number;
  uniquePosters: number;
}

export type PlatformActivityLevel = "high" | "medium" | "low" | "dormant";

@injectable()
export class UserActivityService {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  /**
   * Track user posting activity for dynamic cache TTL and strategy selection
   * Called when a post is created
   */
  async trackPostCreated(userPublicId: UserPublicId): Promise<void> {
    const now = Date.now();
    const oneHourMs = 3600000;

    try {
      const existing = await this.redisService.get<UserActivityMetrics>(
        USER_ACTIVITY_METRICS_KEY,
      );

      if (existing) {
        const hoursSinceLastUpdate = (now - existing.lastUpdated) / oneHourMs;

        // exponential decay with ~12 hour half-life for rolling count
        const decayFactor = Math.exp(-hoursSinceLastUpdate / 12);
        const decayedCount = existing.postCount * decayFactor;

        // check if we need to reset the recent window (every hour)
        let recentPostCount = existing.recentPostCount;
        let recentWindowStart = existing.recentWindowStart;

        if (now - existing.recentWindowStart > oneHourMs) {
          // start a new window
          recentPostCount = 1;
          recentWindowStart = now;
        } else {
          // add to current window
          recentPostCount += 1;
        }

        // track unique posters in a rolling set (increment if new activity)
        // for more accurate tracking we could use HyperLogLog but this is good enough fpr now
        const uniquePosters = Math.max(
          existing.uniquePosters,
          Math.ceil(decayedCount / 3),
        );

        await this.redisService.set(
          USER_ACTIVITY_METRICS_KEY,
          {
            postCount: decayedCount + 1,
            lastUpdated: now,
            recentPostCount,
            recentWindowStart,
            uniquePosters: uniquePosters + (hoursSinceLastUpdate > 1 ? 1 : 0),
          } as UserActivityMetrics,
          AdaptiveTTL.METRICS_STORAGE,
        );
      } else {
        // first activity ever
        await this.redisService.set(
          USER_ACTIVITY_METRICS_KEY,
          {
            postCount: 1,
            lastUpdated: now,
            recentPostCount: 1,
            recentWindowStart: now,
            uniquePosters: 1,
          } as UserActivityMetrics,
          AdaptiveTTL.METRICS_STORAGE,
        );
      }

      // track this specific user as recently active
      await this.trackRecentlyActiveUser(userPublicId);

      logger.debug(
        `[UserActivityService] Tracked post created by ${userPublicId}`,
      );
    } catch (error) {
      // just log
      logger.warn("[UserActivityService] Error tracking user activity", error);
    }
  }

  /**
   * Track users who have recently posted (for low-traffic mode)
   * Uses a sorted set with timestamp scores for easy time-based queries
   */
  private async trackRecentlyActiveUser(
    userPublicId: UserPublicId,
  ): Promise<void> {
    const key = "who_to_follow:recently_active_users";
    const score = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    try {
      // add user with current timestamp as score
      await this.redisService.zadd(key, score, userPublicId);

      // clean up entries older than 7 days
      const cutoff = Date.now() - sevenDaysMs;
      await this.redisService.zremRangeByScore(key, "-inf", cutoff.toString());

      // set TTL on the key
      await this.redisService.expire(key, AdaptiveTTL.METRICS_STORAGE);
    } catch (error) {
      logger.warn(
        "[UserActivityService] Error tracking recently active user",
        error,
      );
    }
  }

  /**
   * Get recently active user publicIds (users who posted in last N days)
   */
  async getRecentlyActiveUsers(days: number = 7): Promise<string[]> {
    const key = "who_to_follow:recently_active_users";
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    try {
      const results = await this.redisService.zrangeByScore(
        key,
        cutoff.toString(),
        "+inf",
      );
      return results || [];
    } catch (error) {
      logger.warn(
        "[UserActivityService] Error getting recently active users",
        error,
      );
      return [];
    }
  }

  /**
   * Get current activity metrics
   */
  async getActivityMetrics(): Promise<UserActivityMetrics | null> {
    try {
      return await this.redisService.get<UserActivityMetrics>(
        USER_ACTIVITY_METRICS_KEY,
      );
    } catch (error) {
      logger.warn(
        "[UserActivityService] Error getting activity metrics",
        error,
      );
      return null;
    }
  }

  /**
   * Determine the platform activity level for strategy selection
   */
  async getPlatformActivityLevel(): Promise<PlatformActivityLevel> {
    try {
      const metrics = await this.getActivityMetrics();

      if (!metrics) {
        // no metrics = new/dormant platform, use low-traffic strategy
        return "dormant";
      }

      const now = Date.now();
      const hoursSinceWindowStart = Math.max(
        0.1,
        (now - metrics.recentWindowStart) / 3600000,
      );
      const postsPerHour = metrics.recentPostCount / hoursSinceWindowStart;
      const hoursSinceLastActivity = (now - metrics.lastUpdated) / 3600000;

      // if no activity in configured dormant hours, consider dormant
      if (hoursSinceLastActivity > ActivityThresholds.DORMANT_HOURS.POSTS) {
        return "dormant";
      }

      if (postsPerHour >= ActivityThresholds.POSTS.HIGH) {
        return "high";
      } else if (postsPerHour >= ActivityThresholds.POSTS.MEDIUM) {
        return "medium";
      } else if (postsPerHour >= ActivityThresholds.POSTS.LOW) {
        return "low";
      }

      return "dormant";
    } catch (error) {
      logger.warn(
        "[UserActivityService] Error determining activity level",
        error,
      );
      return "dormant";
    }
  }

  /**
   * Calculate dynamic TTL based on activity level
   */
  async calculateDynamicTTL(): Promise<number> {
    const level = await this.getPlatformActivityLevel();

    switch (level) {
      case "high":
        return AdaptiveTTL.WHO_TO_FOLLOW.HIGH_ACTIVITY;
      case "medium":
        return AdaptiveTTL.WHO_TO_FOLLOW.MEDIUM_ACTIVITY;
      case "low":
        return AdaptiveTTL.WHO_TO_FOLLOW.LOW_ACTIVITY;
      default:
        return AdaptiveTTL.WHO_TO_FOLLOW.DORMANT;
    }
  }

  /**
   * Get platform size thresholds for external use
   */
  getPlatformSizeThresholds() {
    return PlatformSizeThresholds;
  }

  /**
   * Helper to convert TTL seconds to human readable string for logging
   */
  ttlToHuman(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
}
