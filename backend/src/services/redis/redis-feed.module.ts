import { RedisClientType } from "redis";
import {
  decodeFeedCursor,
  encodeFeedCursor,
  FEED_CURSOR_SNAPSHOT_GENERATION_SECONDS,
  FEED_CURSOR_SNAPSHOT_TTL_SECONDS,
  FEED_CURSOR_ORDER,
  FeedCursorSnapshot,
  hashFeedCursorScope,
  MAX_FEED_CURSOR_SNAPSHOT_BYTES,
  MAX_FEED_CURSOR_SNAPSHOT_ITEMS,
} from "@/utils/feedCursor";
import { Errors } from "@/utils/errors";
import type { MetricsService } from "@/metrics/metrics.service";

const MAX_SNAPSHOT_STRING_LENGTH = 128;

export class RedisFeedModule {
  private readonly snapshotBuilds = new Map<
    string,
    Promise<{ id: string; snapshot: FeedCursorSnapshot }>
  >();

  constructor(
    private readonly client: RedisClientType,
    private readonly metricsService?: Pick<
      MetricsService,
      | "recordFeedCursorSnapshotAccess"
      | "recordFeedCursorSnapshotCreation"
      | "recordFeedCursorSnapshotBuildCollision"
    >,
  ) {}

  async updateTrendingScore(
    postId: string,
    score: number,
    key = "trending:global",
  ): Promise<void> {
    await this.client.zAdd(key, [{ score: Number(score), value: postId }]);
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
          async () => this.buildRedisSnapshot(key),
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
    if (existing) {
      this.metricsService?.recordFeedCursorSnapshotAccess(true);
      return { id, snapshot: existing };
    }

    const inFlight = this.snapshotBuilds.get(id);
    if (inFlight) {
      this.metricsService?.recordFeedCursorSnapshotBuildCollision();
      return await inFlight;
    }

    this.metricsService?.recordFeedCursorSnapshotAccess(false);
    const creation = this.createFeedCursorSnapshot(id, build);
    this.snapshotBuilds.set(id, creation);
    try {
      return await creation;
    } finally {
      if (this.snapshotBuilds.get(id) === creation) {
        this.snapshotBuilds.delete(id);
      }
    }
  }

  private async createFeedCursorSnapshot(
    id: string,
    build: () => Promise<FeedCursorSnapshot>,
  ): Promise<{ id: string; snapshot: FeedCursorSnapshot }> {
    const startedAt = Date.now();
    const snapshot = await build();
    this.assertFeedCursorSnapshot(snapshot);
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, "utf8") > MAX_FEED_CURSOR_SNAPSHOT_BYTES) {
      throw Errors.internal("Feed cursor snapshot exceeds the maximum size");
    }

    const created = await this.client.set(this.getFeedCursorSnapshotKey(id), serialized, {
      EX: FEED_CURSOR_SNAPSHOT_TTL_SECONDS,
      NX: true,
    });
    const stored = await this.getFeedCursorSnapshot(id);
    if (!stored) {
      throw Errors.internal("Could not persist feed cursor snapshot");
    }
    if (created === "OK") {
      this.metricsService?.recordFeedCursorSnapshotCreation(
        Buffer.byteLength(serialized, "utf8"),
        Date.now() - startedAt,
      );
    } else {
      this.metricsService?.recordFeedCursorSnapshotBuildCollision();
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

  private async buildRedisSnapshot(key: string): Promise<FeedCursorSnapshot> {
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
      feed: "trending",
      order: FEED_CURSOR_ORDER.TRENDING,
      source: "redis",
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
      (snapshot?.feed === "preview" &&
        (snapshot.order === FEED_CURSOR_ORDER.PREVIEW_LATEST ||
          snapshot.order === FEED_CURSOR_ORDER.PREVIEW_RELEVANT) &&
        snapshot.source === "mongo" && typeof snapshot.scope === "string") ||
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
            key !== "score" && key !== "reason" && key !== "rankBreakdown" && key !== "formatMix",
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
        (entry.rankBreakdown !== undefined && (
          entry.rankBreakdown === null || typeof entry.rankBreakdown !== "object" ||
          Object.keys(entry.rankBreakdown).length !== 4 ||
          ["freshness", "popularity", "topic", "format"].some((key) => {
            const value = entry.rankBreakdown![key as keyof typeof entry.rankBreakdown];
            return typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1;
          }) || entry.score === undefined ||
          Math.abs(Object.values(entry.rankBreakdown).reduce((sum, value) => sum + value, 0) - entry.score) > 1e-12
        )) ||
        (entry.formatMix !== undefined && (
          entry.formatMix === null || typeof entry.formatMix !== "object" || Object.keys(entry.formatMix).length !== 3 ||
          !["text", "image", "mixed"].includes(entry.formatMix.format) ||
          typeof entry.formatMix.share !== "number" || !Number.isFinite(entry.formatMix.share) || entry.formatMix.share <= 0 || entry.formatMix.share > 1 ||
          !Number.isSafeInteger(entry.formatMix.basePosition) || entry.formatMix.basePosition < 0
        )) ||
        (entry.reason !== undefined && (typeof entry.reason !== "string" || !/^(?:(?:chosen|learned):[a-z]{1,32}|format:(?:text|image|mixed)|activity)$/.test(entry.reason))) ||
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

