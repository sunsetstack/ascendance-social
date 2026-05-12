import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetTrendingTagsQuery } from "./getTrendingTags.query";
import { inject, injectable } from "tsyringe";
import { RedisService } from "@/services/redis.service";
import {
  TAG_ACTIVITY_METRICS_KEY,
  TagActivityMetrics,
} from "@/services/tag.service";
import type {
  IPostReadRepository,
  IFeedReadDao,
} from "@/repositories/interfaces";
import { AdaptiveTTL, ActivityThresholds } from "@/config/cacheConfig";
import { Errors, wrapError } from "@/utils/errors";
import { GetTrendingTagsResult, TrendingTag } from "@/types";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetTrendingTagsQueryHandler implements IQueryHandler<
  GetTrendingTagsQuery,
  GetTrendingTagsResult
> {
  private readonly CACHE_KEY_PREFIX = CacheKeyBuilder.getTrendingTagsPrefix();
  private readonly HISTORICAL_KEY = "trending_tags:historical";

  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  async execute(query: GetTrendingTagsQuery): Promise<GetTrendingTagsResult> {
    try {
      const limit = Math.min(Math.max(query.limit ?? 5, 1), 20);
      const timeWindowHours = Math.max(1, query.timeWindowHours ?? 168);
      const cacheKey = CacheKeyBuilder.getTrendingTagsKey(
        limit,
        timeWindowHours,
      );

      // try to get from cache first
      const cached =
        await this.redisService.get<GetTrendingTagsResult>(cacheKey);
      if (cached) {
        logger.info("[GetTrendingTagsQuery] Returning cached trending tags");
        return cached;
      }

      // compute trending tags with tiered fallback (Cache Waterfall pattern)
      let tags = await this.computeTrendingTags(limit, timeWindowHours);
      let usedExtendedWindow = false;

      // tier 1: if no tags found, try progressively wider time windows
      if (tags.length === 0) {
        const extendedWindows = [336, 720, 2160, 4320]; // 2 weeks, 1 month, 3 months, 6 months
        for (const window of extendedWindows) {
          tags = await this.computeTrendingTags(limit, window);
          if (tags.length > 0) {
            logger.info(
              `[GetTrendingTagsQuery] Found tags with extended window: ${window}h`,
            );
            usedExtendedWindow = true;
            break;
          }
        }
      }

      // tier 2: if still no tags, fall back to historical cache (Stale-While-Revalidate adjacent)
      if (tags.length === 0) {
        const historical = await this.redisService.get<GetTrendingTagsResult>(
          this.HISTORICAL_KEY,
        );
        if (historical && historical.tags.length > 0) {
          logger.info(
            "[GetTrendingTagsQuery] Using historical trending tags fallback",
          );
          // cache the historical result with dormant TTL so we don't keep hitting DB
          await this.redisService.set(
            cacheKey,
            historical,
            AdaptiveTTL.TRENDING_TAGS.DORMANT,
          );
          return historical;
        }
      }

      const result: GetTrendingTagsResult = { tags };

      // calculate dynamic TTL based on activity metrics (Activity-Based Cache Decay)
      const ttl = await this.calculateDynamicTTL(usedExtendedWindow);

      // cache with dynamic TTL
      await this.redisService.set(cacheKey, result, ttl);

      // update historical cache if we have fresh data (not from extended window)
      if (tags.length > 0 && !usedExtendedWindow) {
        await this.redisService.set(
          this.HISTORICAL_KEY,
          result,
          AdaptiveTTL.TRENDING_TAGS.HISTORICAL,
        );
        logger.info(
          "[GetTrendingTagsQuery] Updated historical cache with fresh data",
        );
      }

      logger.info(
        `[GetTrendingTagsQuery] Cached ${tags.length} trending tags with TTL: ${ttl}s (${this.ttlToHuman(ttl)})`,
      );
      return result;
    } catch (error) {
      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal(
        "An unknown error occurred while fetching trending tags",
      );
    }
  }

  /**
   * Calculate dynamic TTL based on site activity level
   * Reads activity metrics tracked by TagService when tags are used
   * Low activity = long TTL (keep tags visible longer)
   * High activity = short TTL (refresh more frequently)
   */
  private async calculateDynamicTTL(
    usedExtendedWindow: boolean,
  ): Promise<number> {
    // if we had to use extended window, site is definitely slow - use longer TTL
    if (usedExtendedWindow) {
      return AdaptiveTTL.TRENDING_TAGS.LOW_ACTIVITY;
    }

    try {
      const metrics = await this.redisService.get<TagActivityMetrics>(
        TAG_ACTIVITY_METRICS_KEY,
      );

      if (!metrics) {
        // no activity tracked yet, use medium TTL as safe default
        logger.info(
          "[GetTrendingTagsQuery] No activity metrics found, using medium TTL",
        );
        return AdaptiveTTL.TRENDING_TAGS.MEDIUM_ACTIVITY;
      }

      // calculate tags per hour from recent window
      const now = Date.now();
      const hoursSinceWindowStart = Math.max(
        0.1,
        (now - metrics.recentWindowStart) / 3600000,
      );
      const tagsPerHour = metrics.recentUsageCount / hoursSinceWindowStart;

      // also consider time since last activity
      const hoursSinceLastActivity = (now - metrics.lastUpdated) / 3600000;

      // if no activity in the configured dormant hours, site is dormant regardless of historical rate
      if (hoursSinceLastActivity > ActivityThresholds.DORMANT_HOURS.TAGS) {
        logger.info(
          `[GetTrendingTagsQuery] No activity in ${hoursSinceLastActivity.toFixed(1)}h, using dormant TTL`,
        );
        return AdaptiveTTL.TRENDING_TAGS.DORMANT;
      }

      // determine TTL based on activity rate
      let ttl: number;
      if (tagsPerHour >= ActivityThresholds.TAGS.HIGH) {
        ttl = AdaptiveTTL.TRENDING_TAGS.HIGH_ACTIVITY;
      } else if (tagsPerHour >= ActivityThresholds.TAGS.MEDIUM) {
        ttl = AdaptiveTTL.TRENDING_TAGS.MEDIUM_ACTIVITY;
      } else if (tagsPerHour >= ActivityThresholds.TAGS.LOW) {
        ttl = AdaptiveTTL.TRENDING_TAGS.LOW_ACTIVITY;
      } else if (tagsPerHour >= ActivityThresholds.TAGS.VERY_LOW) {
        ttl = AdaptiveTTL.TRENDING_TAGS.VERY_LOW_ACTIVITY;
      } else {
        ttl = AdaptiveTTL.TRENDING_TAGS.DORMANT;
      }

      logger.info(
        `[GetTrendingTagsQuery] Activity: ${tagsPerHour.toFixed(2)} tags/hour -> TTL: ${this.ttlToHuman(ttl)}`,
      );
      return ttl;
    } catch (error) {
      logger.warn(
        "[GetTrendingTagsQuery] Error calculating dynamic TTL, using medium",
        error,
      );
      return AdaptiveTTL.TRENDING_TAGS.MEDIUM_ACTIVITY;
    }
  }

  /**
   * Helper to convert TTL seconds to human readable string for logging
   */
  private ttlToHuman(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }

  /**
   * Invalidate the trending tags cache when new posts with tags are created
   */
  async invalidateCache(): Promise<void> {
    try {
      const deleted = await this.redisService.del(`${this.CACHE_KEY_PREFIX}:*`);
      logger.info(
        `[GetTrendingTagsQuery] Cache invalidated (keys deleted: ${deleted})`,
      );
    } catch (error) {
      console.error(
        "[GetTrendingTagsQuery] Failed to invalidate cache:",
        error,
      );
    }
  }

  /**
   * computes trending tags based on:
   * 1. recent activity (modifiedAt within time window)
   * 2. total post count (count field)
   * sorts by recency and popularity
   */
  private async computeTrendingTags(
    limit: number,
    timeWindowHours: number,
  ): Promise<TrendingTag[]> {
    const trendingTags = await this.feedReadDao.getTrendingTags(
      limit,
      timeWindowHours,
    );

    logger.info(
      `[GetTrendingTagsQuery] Found ${trendingTags.length} trending tags`,
    );
    if (trendingTags.length > 0) {
      logger.info(
        `[GetTrendingTagsQuery] Top tag: ${trendingTags[0].tag} (count: ${trendingTags[0].count})`,
      );
    }

    return trendingTags;
  }
}
