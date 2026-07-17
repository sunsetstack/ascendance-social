import { RedisClientType } from "redis";
import { CacheKeyBuilder, RedisFeedType } from "@/utils/cache/CacheKeyBuilder";
import { redisLogger } from "@/utils/winston";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_CURSOR_ORDER,
} from "@/utils/feedCursor";

/** How long per-user feed ZSETs live in Redis (1 hour). */
const FEED_TTL_SECONDS = 3600;
const FEED_WRITE_BATCH_SIZE = 500;

export class RedisFeedModule {
  constructor(private readonly client: RedisClientType) {}

  async addToFeed(
    userId: string,
    postId: string,
    timestamp: number,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    const feedKey = CacheKeyBuilder.getRedisFeedKey(feedType, userId);
    const pipeline = this.client.multi();
    pipeline.zAdd(feedKey, { score: timestamp, value: postId });
    pipeline.expire(feedKey, FEED_TTL_SECONDS);
    await pipeline.exec();
  }

  async addToFeedsBatch(
    userIds: string[],
    postId: string,
    timestamp: number,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    if (userIds.length === 0) return;

    const uniqueUserIds = [...new Set(userIds)];
    for (let i = 0; i < uniqueUserIds.length; i += FEED_WRITE_BATCH_SIZE) {
      const batch = uniqueUserIds.slice(i, i + FEED_WRITE_BATCH_SIZE);
      const pipeline = this.client.multi();
      for (const userId of batch) {
        const feedKey = CacheKeyBuilder.getRedisFeedKey(feedType, userId);
        pipeline.zAdd(feedKey, { score: timestamp, value: postId });
        pipeline.expire(feedKey, FEED_TTL_SECONDS);
      }
      await pipeline.exec();
    }
  }

  async getFeedPage(
    userId: string,
    page: number,
    limit: number,
    feedType: RedisFeedType = "for_you",
  ): Promise<string[]> {
    const feedKey = CacheKeyBuilder.getRedisFeedKey(feedType, userId);
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    redisLogger.debug("getFeedPage called", {
      userId,
      feedType,
      page,
      limit,
      feedKey,
    });

    try {
      const result = await this.client.zRange(feedKey, start, end, {
        REV: true,
      });
      redisLogger.info("getFeedPage result", {
        userId,
        feedType,
        count: result.length,
      });
      return result;
    } catch (error) {
      redisLogger.error("getFeedPage failed", {
        userId,
        feedType,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getFeedWithCursor(
    userId: string,
    limit: number,
    cursor?: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<{
    ids: string[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const key = CacheKeyBuilder.getRedisFeedKey(feedType, userId);
    const decoded = cursor
      ? decodeFeedCursor(cursor, {
          feed: "for-you",
          orders: [FEED_CURSOR_ORDER.FOR_YOU],
          source: "redis",
        })
      : null;
    const maxScore =
      decoded?.score !== undefined ? String(decoded.score) : "+inf";
    const maxId = decoded?._id ?? "";

    return this.paginateZSet(
      key,
      limit,
      maxScore,
      maxId,
      cursor,
      (score, id, pageIds) =>
      encodeFeedCursor({
        feed: "for-you",
        order: FEED_CURSOR_ORDER.FOR_YOU,
        source: "redis",
        score,
        _id: id,
        seenPublicIds: [
          ...new Set([...(decoded?.seenPublicIds ?? []), ...pageIds]),
        ],
      }),
    );
  }

  async removeFromFeed(
    userId: string,
    postId: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    await this.client.zRem(
      CacheKeyBuilder.getRedisFeedKey(feedType, userId),
      postId,
    );
  }

  async removeFromFeedsBatch(
    userIds: string[],
    postId: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    if (userIds.length === 0) return;

    const uniqueUserIds = [...new Set(userIds)];
    for (let i = 0; i < uniqueUserIds.length; i += FEED_WRITE_BATCH_SIZE) {
      const batch = uniqueUserIds.slice(i, i + FEED_WRITE_BATCH_SIZE);
      const pipeline = this.client.multi();
      for (const userId of batch) {
        pipeline.zRem(CacheKeyBuilder.getRedisFeedKey(feedType, userId), postId);
      }
      await pipeline.exec();
    }
  }

  async removePostsFromFeedsBatch(
    userIds: string[],
    postIds: string[],
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    if (userIds.length === 0 || postIds.length === 0) return;

    const uniqueUserIds = [...new Set(userIds)];
    const uniquePostIds = [...new Set(postIds)];
    for (let index = 0; index < uniqueUserIds.length; index += FEED_WRITE_BATCH_SIZE) {
      const batch = uniqueUserIds.slice(index, index + FEED_WRITE_BATCH_SIZE);
      const pipeline = this.client.multi();
      for (const userId of batch) {
        pipeline.zRem(
          CacheKeyBuilder.getRedisFeedKey(feedType, userId),
          uniquePostIds,
        );
      }
      await pipeline.exec();
    }
  }

  async invalidateFeed(userId: string, feedType: RedisFeedType = "for_you"): Promise<void> {
    await this.client.del(CacheKeyBuilder.getRedisFeedKey(feedType, userId));
  }

  async getFeedSize(userId: string, feedType: RedisFeedType = "for_you"): Promise<number> {
    return await this.client.zCard(
      CacheKeyBuilder.getRedisFeedKey(feedType, userId),
    );
  }

  async updateTrendingScore(
    postId: string,
    score: number,
    key = "trending:global",
  ): Promise<void> {
    await this.client.zAdd(key, [{ score: Number(score), value: postId }]);
  }

  async incrTrendingScore(
    postId: string,
    delta: number,
    key = "trending:global",
  ): Promise<number> {
    const newScore = await this.client.zIncrBy(key, delta, postId);
    return Number(newScore);
  }

  async getTrendingRange(
    start: number,
    end: number,
    key = "trending:posts",
  ): Promise<string[]> {
    return await this.client.zRange(key, start, end, { REV: true });
  }

  async getTrendingCount(key = "trending:posts"): Promise<number> {
    return await this.client.zCard(key);
  }

  async getTrendingFeedWithCursor(
    limit: number,
    cursor?: string,
    key = "trending:posts",
  ): Promise<{
    ids: string[];
    hasMore: boolean;
    nextCursor?: string;
  }> {
    const decoded = cursor
      ? decodeFeedCursor(cursor, {
          feed: "trending",
          orders: [FEED_CURSOR_ORDER.TRENDING],
          source: "redis",
        })
      : null;
    const maxScore =
      decoded?.trendScore !== undefined && decoded?.trendScore !== null
        ? String(decoded.trendScore)
        : "+inf";
    const maxId = String(decoded?._id ?? "");

    return this.paginateZSet(
      key,
      limit,
      maxScore,
      maxId,
      cursor,
      (score, id, pageIds) =>
      encodeFeedCursor({
        feed: "trending",
        order: FEED_CURSOR_ORDER.TRENDING,
        source: "redis",
        phase: "trending",
        trendScore: score,
        _id: id,
        seenPublicIds: [
          ...new Set([...(decoded?.seenPublicIds ?? []), ...pageIds]),
        ],
      }),
    );
  }

  /**
   * Shared cursor-pagination logic for Redis sorted sets (score-based, descending).
   * Handles the zRangeWithScores fetch, tie-break filtering, slice, and next-cursor encoding.
   */
  private async paginateZSet(
    key: string,
    limit: number,
    maxScore: string,
    maxId: string,
    cursor: string | undefined,
    buildNextCursor: (score: number, id: string, pageIds: string[]) => string,
  ): Promise<{ ids: string[]; hasMore: boolean; nextCursor?: string }> {
    type ZRangeWithScoresReply = Awaited<
      ReturnType<RedisClientType["zRangeWithScores"]>
    >;

    const fetchCount = Math.max(limit * 2, limit + 10);
    const filtered: ZRangeWithScoresReply = [];
    let offset = 0;

    while (filtered.length <= limit) {
      const batch = await this.client.zRangeWithScores(key, maxScore, "-inf", {
        BY: "SCORE" as const,
        REV: true as const,
        LIMIT: { offset, count: fetchCount },
      });

      if (batch.length === 0) {
        break;
      }

      const eligible =
        cursor && maxId
          ? batch.filter((item) => {
              const cursorScore = Number(maxScore);
              if (item.score < cursorScore) return true;
              if (item.score === cursorScore) return item.value < maxId;
              return false;
            })
          : batch;

      filtered.push(...eligible);

      if (!cursor || filtered.length > limit || batch.length < fetchCount) {
        break;
      }

      offset += fetchCount;
    }

    const hasMore = filtered.length > limit;
    const sliced = filtered.slice(0, limit);
    const ids = sliced.map((item: ZRangeWithScoresReply[number]) => item.value);

    let nextCursor: string | undefined;
    if (hasMore && sliced.length > 0) {
      const last = sliced[sliced.length - 1];
      nextCursor = buildNextCursor(last.score, last.value, ids);
    }

    return { ids, hasMore, nextCursor };
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return await this.client.zAdd(key, { score, value: member });
  }

  async zrem(key: string, member: string): Promise<number> {
    return await this.client.zRem(key, member);
  }

  async zrangeByScore(
    key: string,
    min: string,
    max: string,
  ): Promise<string[]> {
    return await this.client.zRangeByScore(key, min, max);
  }

  async zremRangeByScore(
    key: string,
    min: string,
    max: string,
  ): Promise<number> {
    return await this.client.zRemRangeByScore(key, min, max);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return await this.client.expire(key, seconds);
  }
}

