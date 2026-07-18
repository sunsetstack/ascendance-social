import { RedisClientType } from "redis";
import { CacheKeyBuilder, RedisFeedType } from "@/utils/cache/CacheKeyBuilder";
import { redisLogger } from "@/utils/winston";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_CURSOR_SNAPSHOT_GENERATION_SECONDS,
  FEED_CURSOR_SNAPSHOT_TTL_SECONDS,
  FEED_CURSOR_ORDER,
  FeedCursorSnapshot,
  hashFeedCursorScope,
} from "@/utils/feedCursor";
import { Errors } from "@/utils/errors";

/** How long per-user feed ZSETs live in Redis (1 hour). */
const FEED_TTL_SECONDS = 3600;
const FEED_WRITE_BATCH_SIZE = 500;
const MAX_FEED_CURSOR_SNAPSHOT_ITEMS = 50_000;
const MAX_FEED_CURSOR_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_STRING_LENGTH = 128;

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
    snapshotId?: string;
    consumedOffset?: number;
  }> {
    const key = CacheKeyBuilder.getRedisFeedKey(feedType, userId);
    const scope = hashFeedCursorScope(["redis-feed", key]);
    const decoded = cursor
      ? decodeFeedCursor(cursor, {
          feed: "for-you",
          orders: [FEED_CURSOR_ORDER.FOR_YOU],
          source: "redis",
        })
      : null;
    if (decoded && decoded.scope !== scope) {
      throw Errors.validation("Feed cursor does not match this user feed");
    }

    const snapshotRef = decoded
      ? {
          id: decoded.snapshotId,
          snapshot: await this.requireFeedCursorSnapshot(decoded.snapshotId, {
            feed: "for-you",
            order: FEED_CURSOR_ORDER.FOR_YOU,
            source: "redis",
            scope,
          }),
        }
      : await this.getOrCreateFeedCursorSnapshot(
          `redis-feed:${key}`,
          async () => this.buildRedisSnapshot(key, "for-you", FEED_CURSOR_ORDER.FOR_YOU, scope),
        );

    return this.paginateSnapshot(
      snapshotRef,
      decoded?.offset ?? 0,
      limit,
      (offset) =>
        encodeFeedCursor({
          feed: "for-you",
          order: FEED_CURSOR_ORDER.FOR_YOU,
          source: "redis",
          snapshotId: snapshotRef.id,
          offset,
          scope,
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
    snapshotId?: string;
    consumedOffset?: number;
  }> {
    const decoded = cursor
      ? decodeFeedCursor(cursor, {
          feed: "trending",
          orders: [FEED_CURSOR_ORDER.TRENDING],
          source: "redis",
        })
      : null;
    const snapshotRef = decoded
      ? {
          id: decoded.snapshotId,
          snapshot: await this.requireFeedCursorSnapshot(decoded.snapshotId, {
            feed: "trending",
            order: FEED_CURSOR_ORDER.TRENDING,
            source: "redis",
          }),
        }
      : await this.getOrCreateFeedCursorSnapshot(
          `redis-feed:${key}`,
          async () => this.buildRedisSnapshot(key, "trending", FEED_CURSOR_ORDER.TRENDING),
        );

    return this.paginateSnapshot(
      snapshotRef,
      decoded?.offset ?? 0,
      limit,
      (offset) =>
        encodeFeedCursor({
          feed: "trending",
          order: FEED_CURSOR_ORDER.TRENDING,
          source: "redis",
          phase: "trending",
          snapshotId: snapshotRef.id,
          offset,
        }),
    );
  }

  async getOrCreateFeedCursorSnapshot(
    contextKey: string,
    build: () => Promise<FeedCursorSnapshot>,
  ): Promise<{ id: string; snapshot: FeedCursorSnapshot }> {
    const contextHash = hashFeedCursorScope([contextKey]);
    const bucket = Math.floor(
      Date.now() / (FEED_CURSOR_SNAPSHOT_GENERATION_SECONDS * 1000),
    );
    const id = `${contextHash}.${bucket}`;
    const existing = await this.getFeedCursorSnapshot(id);
    if (existing) return { id, snapshot: existing };

    const snapshot = await build();
    this.assertFeedCursorSnapshot(snapshot);
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, "utf8") > MAX_FEED_CURSOR_SNAPSHOT_BYTES) {
      throw Errors.internal("Feed cursor snapshot exceeds the maximum size");
    }

    await this.client.set(this.getFeedCursorSnapshotKey(id), serialized, {
      EX: FEED_CURSOR_SNAPSHOT_TTL_SECONDS,
      NX: true,
    });
    const stored = await this.getFeedCursorSnapshot(id);
    if (!stored) {
      throw Errors.internal("Could not persist feed cursor snapshot");
    }
    return { id, snapshot: stored };
  }

  async getFeedCursorSnapshot(id: string): Promise<FeedCursorSnapshot | null> {
    if (!/^[A-Za-z0-9_-]{43}\.[0-9]{1,12}$/.test(id)) return null;
    const key = this.getFeedCursorSnapshotKey(id);
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      if (Buffer.byteLength(raw, "utf8") > MAX_FEED_CURSOR_SNAPSHOT_BYTES) {
        return null;
      }
      const snapshot = JSON.parse(raw) as FeedCursorSnapshot;
      this.assertFeedCursorSnapshot(snapshot);
      await this.client.expire(key, FEED_CURSOR_SNAPSHOT_TTL_SECONDS);
      return snapshot;
    } catch {
      return null;
    }
  }

  async requireFeedCursorSnapshot(
    id: string,
    expected: Pick<FeedCursorSnapshot, "feed" | "order" | "source"> & {
      scope?: string;
    },
  ): Promise<FeedCursorSnapshot> {
    const snapshot = await this.getFeedCursorSnapshot(id);
    if (
      !snapshot ||
      snapshot.feed !== expected.feed ||
      snapshot.order !== expected.order ||
      snapshot.source !== expected.source ||
      snapshot.scope !== expected.scope
    ) {
      throw Errors.validation("Feed cursor snapshot is missing or expired");
    }
    return snapshot;
  }

  private async buildRedisSnapshot(
    key: string,
    feed: "for-you" | "trending",
    order: typeof FEED_CURSOR_ORDER.FOR_YOU | typeof FEED_CURSOR_ORDER.TRENDING,
    scope?: string,
  ): Promise<FeedCursorSnapshot> {
    const items = await this.client.zRangeWithScores(
      key,
      0,
      MAX_FEED_CURSOR_SNAPSHOT_ITEMS,
      { REV: true },
    );
    if (items.length > MAX_FEED_CURSOR_SNAPSHOT_ITEMS) {
      throw Errors.internal("Feed cursor snapshot contains too many items");
    }
    return {
      version: 1,
      feed,
      order,
      source: "redis",
      scope,
      entries: items.map((item) => ({
        _id: item.value,
        publicId: item.value,
        visibleIdentityId: item.value,
        score: item.score,
      })),
    };
  }

  private paginateSnapshot(
    snapshotRef: { id: string; snapshot: FeedCursorSnapshot },
    offset: number,
    limit: number,
    buildNextCursor: (offset: number) => string,
  ): {
    ids: string[];
    hasMore: boolean;
    nextCursor?: string;
    snapshotId: string;
    consumedOffset: number;
  } {
    const page = snapshotRef.snapshot.entries.slice(offset, offset + limit + 1);
    const hasMore = page.length > limit;
    const visible = page.slice(0, limit);
    const consumedOffset = offset + visible.length;
    return {
      ids: visible.map((entry) => entry.publicId),
      hasMore,
      nextCursor:
        hasMore && visible.length > 0
          ? buildNextCursor(consumedOffset)
          : undefined,
      snapshotId: snapshotRef.id,
      consumedOffset,
    };
  }

  private assertFeedCursorSnapshot(snapshot: FeedCursorSnapshot): void {
    const allowedKeys = new Set([
      "version",
      "feed",
      "order",
      "source",
      "scope",
      "entries",
      "excludedIdentityIds",
    ]);
    const isKnownVariant =
      (snapshot?.feed === "new" &&
        snapshot.order === FEED_CURSOR_ORDER.NEW &&
        snapshot.source === "mongo" &&
        snapshot.scope === undefined) ||
      (snapshot?.feed === "personalized" &&
        snapshot.order === FEED_CURSOR_ORDER.PERSONALIZED_RANKED &&
        snapshot.source === "mongo" &&
        typeof snapshot.scope === "string") ||
      (snapshot?.feed === "for-you" &&
        snapshot.order === FEED_CURSOR_ORDER.FOR_YOU &&
        (snapshot.source === "mongo" || snapshot.source === "redis") &&
        typeof snapshot.scope === "string") ||
      (snapshot?.feed === "trending" &&
        snapshot.order === FEED_CURSOR_ORDER.TRENDING &&
        (snapshot.source === "mongo" || snapshot.source === "redis") &&
        snapshot.scope === undefined);
    if (
      !snapshot ||
      snapshot.version !== 1 ||
      Object.keys(snapshot).some((key) => !allowedKeys.has(key)) ||
      !isKnownVariant ||
      (snapshot.scope !== undefined &&
        !/^[A-Za-z0-9_-]{43}$/.test(snapshot.scope)) ||
      !Array.isArray(snapshot.entries) ||
      snapshot.entries.length > MAX_FEED_CURSOR_SNAPSHOT_ITEMS ||
      (snapshot.excludedIdentityIds !== undefined &&
        (!Array.isArray(snapshot.excludedIdentityIds) ||
          snapshot.excludedIdentityIds.length > MAX_FEED_CURSOR_SNAPSHOT_ITEMS))
    ) {
      throw Errors.validation("Invalid feed cursor snapshot");
    }
    const entryIds = new Set<string>();
    for (const entry of snapshot.entries) {
      if (
        !entry ||
        Object.keys(entry).some(
          (key) =>
            key !== "_id" &&
            key !== "publicId" &&
            key !== "visibleIdentityId" &&
            key !== "score",
        ) ||
        typeof entry._id !== "string" ||
        typeof entry.publicId !== "string" ||
        typeof entry.visibleIdentityId !== "string" ||
        entry._id.length === 0 ||
        entry.publicId.length === 0 ||
        entry.visibleIdentityId.length === 0 ||
        entry._id.length > MAX_SNAPSHOT_STRING_LENGTH ||
        entry.publicId.length > MAX_SNAPSHOT_STRING_LENGTH ||
        entry.visibleIdentityId.length > MAX_SNAPSHOT_STRING_LENGTH ||
        (entry.score !== undefined && !Number.isFinite(entry.score)) ||
        entryIds.has(entry._id)
      ) {
        throw Errors.validation("Invalid feed cursor snapshot entry");
      }
      entryIds.add(entry._id);
    }
    const exclusions = new Set<string>();
    for (const id of snapshot.excludedIdentityIds ?? []) {
      if (
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > MAX_SNAPSHOT_STRING_LENGTH ||
        exclusions.has(id)
      ) {
        throw Errors.validation("Invalid feed cursor snapshot exclusion");
      }
      exclusions.add(id);
    }
  }

  private getFeedCursorSnapshotKey(id: string): string {
    return `feed_cursor_snapshot:v1:${id}`;
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

