import { injectable, inject } from "tsyringe";
import type { RedisClientType } from "redis";
import { INotification } from "@/types";
import { NotificationPlain } from "@/types/customNotifications/notifications.types";
import { MetricsService } from "../metrics/metrics.service";
import { RedisNotificationModule } from "./redis/redis-notification.module";
import { RedisFeedModule } from "./redis/redis-feed.module";
import { RedisStreamModule } from "./redis/redis-stream.module";
import {
  RedisSessionModule,
  SessionWithTtl,
} from "./redis/redis-session.module";
import { RedisFeedType } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
import { XPendingRangeEntry, XClaimReply } from "./redis/redis-stream.module";
import { RedisConnectionModule } from "./redis/redis-connection.module";
import { RedisJsonCacheModule } from "./redis/redis-json-cache.module";
import {
  RedisTaggedCacheModule,
  TaggedCacheEntry,
} from "./redis/redis-tagged-cache.module";
import {
  RedisPubSubModule,
  RedisSubscribeOptions,
} from "./redis/redis-pubsub.module";
import { RedisPresenceModule } from "./redis/redis-presence.module";
import {
  RedisResilienceModule,
  ResilienceConfig,
} from "./redis/redis-resilience.module";

/**
 * The service is much more of a facade now than it used to be.
 * It delegates to the appropriate module, constructs the focused redis modules
 * and has much less reason to change. redis api surface and wiring is pretty much the only reason for change.
 */

@injectable()
export class RedisService {
  private readonly connectionModule: RedisConnectionModule;
  private readonly resilienceModule: RedisResilienceModule;
  private readonly cacheModule: RedisJsonCacheModule;
  private readonly taggedCacheModule: RedisTaggedCacheModule;
  private readonly pubSubModule: RedisPubSubModule;
  private readonly presenceModule: RedisPresenceModule;
  private readonly notificationModule: RedisNotificationModule;
  private readonly feedModule: RedisFeedModule;
  private readonly streamModule: RedisStreamModule;
  private readonly sessionModule: RedisSessionModule;

  constructor(
    @inject(TOKENS.Services.Metrics)
    metricsService: MetricsService,
  ) {
    this.resilienceModule = new RedisResilienceModule();
    this.connectionModule = new RedisConnectionModule(
      metricsService,
      this.resilienceModule,
    );

    const client = this.connectionModule.clientInstance;
    this.cacheModule = new RedisJsonCacheModule(client);
    this.taggedCacheModule = new RedisTaggedCacheModule(
      client,
      this.cacheModule,
      this.resilienceModule,
    );
    this.pubSubModule = new RedisPubSubModule(
      client,
      this.connectionModule,
      this.resilienceModule,
    );
    this.presenceModule = new RedisPresenceModule(client);
    this.notificationModule = new RedisNotificationModule(client);
    this.feedModule = new RedisFeedModule(client);
    this.streamModule = new RedisStreamModule(client);
    this.sessionModule = new RedisSessionModule(client);

    this.connectionModule.start();
  }

  get clientInstance(): RedisClientType {
    return this.connectionModule.clientInstance;
  }

  async createDedicatedClient(): Promise<RedisClientType> {
    return this.connectionModule.createDedicatedClient();
  }

  async waitForConnection(timeoutMs?: number): Promise<boolean> {
    return this.connectionModule.waitForConnection(timeoutMs);
  }

  async withResilience<T>(
    operation: () => Promise<T>,
    config?: ResilienceConfig<T>,
  ): Promise<T> {
    return this.resilienceModule.withResilience(operation, config);
  }

  async getValidated<T>(
    key: string,
    guard: (v: unknown) => v is T,
  ): Promise<T | null> {
    return this.cacheModule.getValidated(key, guard);
  }

  async get<T>(key: string): Promise<T | null> {
    return this.cacheModule.get<T>(key);
  }

  async mGet<T>(keys: string[]): Promise<(T | null)[]> {
    return this.cacheModule.mGet<T>(keys);
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    return this.cacheModule.set(key, value, ttl);
  }

  async exists(key: string): Promise<boolean> {
    return this.cacheModule.exists(key);
  }

  async ttl(key: string): Promise<number> {
    return this.cacheModule.ttl(key);
  }

  async merge<T extends Record<string, unknown>>(
    key: string,
    value: Partial<T>,
    ttl?: number,
  ): Promise<void> {
    return this.cacheModule.merge(key, value, ttl);
  }

  async del(keyPattern: string): Promise<number> {
    return this.cacheModule.del(keyPattern);
  }

  async deletePatterns(patterns: string[]): Promise<void> {
    return this.cacheModule.deletePatterns(patterns);
  }

  async publish<T>(channel: string, message: T): Promise<void> {
    return this.pubSubModule.publish(channel, message);
  }

  async subscribe<T>(
    channels: string[],
    messageHandler: (channel: string, message: T) => void,
    options?: RedisSubscribeOptions,
  ): Promise<boolean> {
    return this.pubSubModule.subscribe(channels, messageHandler, options);
  }

  async unsubscribeAll(): Promise<void> {
    return this.pubSubModule.unsubscribeAll();
  }

  async setWithTags<T>(
    key: string,
    value: T,
    tags: string[],
    ttl?: number,
  ): Promise<void> {
    return this.taggedCacheModule.setWithTags(key, value, tags, ttl);
  }

  async setManyWithTags<T>(
    entries: Array<TaggedCacheEntry<T>>,
    ttl?: number,
  ): Promise<void> {
    return this.taggedCacheModule.setManyWithTags(entries, ttl);
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    return this.taggedCacheModule.invalidateByTags(tags);
  }

  async getWithTags<T>(key: string): Promise<T | null> {
    return this.taggedCacheModule.getWithTags<T>(key);
  }

  async pushNotification(
    userId: string,
    notification: INotification,
    maxCount = 200,
  ): Promise<void> {
    return this.notificationModule.pushNotification(
      userId,
      notification,
      maxCount,
    );
  }

  async backfillNotifications(
    userId: string,
    notifications: INotification[],
    maxCount = 200,
  ): Promise<void> {
    return this.notificationModule.backfillNotifications(
      userId,
      notifications,
      maxCount,
    );
  }

  async getUserNotifications(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<NotificationPlain[]> {
    return this.notificationModule.getUserNotifications(userId, page, limit);
  }

  async getUserNotificationIds(
    userId: string,
    start = 0,
    end = -1,
  ): Promise<string[]> {
    return this.notificationModule.getUserNotificationIds(userId, start, end);
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    return this.notificationModule.markNotificationRead(notificationId);
  }

  async markNotificationsRead(notificationIds: string[]): Promise<void> {
    return this.notificationModule.markNotificationsRead(notificationIds);
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    return this.notificationModule.getUnreadNotificationCount(userId);
  }

  async getAuthSession<T>(sid: string): Promise<T | null> {
    return this.sessionModule.getSession<T>(sid);
  }

  async saveAuthSession<T extends { sid: string; publicId: string }>(
    session: T,
    ttlSeconds: number,
  ): Promise<void> {
    return this.sessionModule.saveSession(session, ttlSeconds);
  }

  async updateAuthSession<T>(
    sid: string,
    session: T,
    ttlSeconds: number,
  ): Promise<void> {
    return this.sessionModule.updateSession(sid, session, ttlSeconds);
  }

  async removeAuthSession(sid: string, publicId: string): Promise<void> {
    return this.sessionModule.removeSession(sid, publicId);
  }

  async removeAuthSessionMembership(
    publicId: string,
    sid: string,
  ): Promise<void> {
    return this.sessionModule.removeSessionMembership(publicId, sid);
  }

  async getUserAuthSessionIds(publicId: string): Promise<string[]> {
    return this.sessionModule.getUserSessionIds(publicId);
  }

  async deleteUserAuthSessions(
    publicId: string,
    sessionIds: string[],
  ): Promise<void> {
    return this.sessionModule.deleteUserSessions(publicId, sessionIds);
  }

  async getAuthSessionTtl(sid: string): Promise<number> {
    return this.sessionModule.getSessionTtl(sid);
  }

  async getAuthSessionsWithTtl<T>(
    sessionIds: string[],
  ): Promise<Array<SessionWithTtl<T>>> {
    return this.sessionModule.getSessionsWithTtl<T>(sessionIds);
  }

  async updateAuthSessions<T>(
    publicId: string,
    updates: Array<SessionWithTtl<T>>,
    staleSessionIds: string[] = [],
  ): Promise<void> {
    return this.sessionModule.updateSessions(
      publicId,
      updates,
      staleSessionIds,
    );
  }

  async addToFeed(
    userId: string,
    postId: string,
    timestamp: number,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    return this.feedModule.addToFeed(userId, postId, timestamp, feedType);
  }

  async addToFeedsBatch(
    userIds: string[],
    postId: string,
    timestamp: number,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    return this.feedModule.addToFeedsBatch(
      userIds,
      postId,
      timestamp,
      feedType,
    );
  }

  async getFeedPage(
    userId: string,
    page: number,
    limit: number,
    feedType: RedisFeedType = "for_you",
  ): Promise<string[]> {
    return this.feedModule.getFeedPage(userId, page, limit, feedType);
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
    return this.feedModule.getFeedWithCursor(userId, limit, cursor, feedType);
  }

  async removeFromFeed(
    userId: string,
    postId: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    return this.feedModule.removeFromFeed(userId, postId, feedType);
  }

  async removeFromFeedsBatch(
    userIds: string[],
    postId: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    return this.feedModule.removeFromFeedsBatch(userIds, postId, feedType);
  }

  async invalidateFeed(
    userId: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<void> {
    return this.feedModule.invalidateFeed(userId, feedType);
  }

  async getFeedSize(
    userId: string,
    feedType: RedisFeedType = "for_you",
  ): Promise<number> {
    return this.feedModule.getFeedSize(userId, feedType);
  }

  async cleanupOrphanedTags(): Promise<void> {
    return this.taggedCacheModule.cleanupOrphanedTags();
  }

  async pushToStream(
    stream = "stream:interactions",
    payload: Record<string, unknown>,
  ): Promise<string> {
    return this.streamModule.pushToStream(stream, payload);
  }

  async createStreamConsumerGroup(
    stream = "stream:interactions",
    group = "trendingGroup",
  ): Promise<void> {
    return this.streamModule.createStreamConsumerGroup(stream, group);
  }

  async ackStreamMessages(
    stream: string,
    group: string,
    ...ids: string[]
  ): Promise<number> {
    return this.streamModule.ackStreamMessages(stream, group, ...ids);
  }

  async updateTrendingScore(
    postId: string,
    score: number,
    key = "trending:posts",
  ): Promise<void> {
    return this.feedModule.updateTrendingScore(postId, score, key);
  }

  async incrTrendingScore(
    postId: string,
    delta: number,
    key = "trending:posts",
  ): Promise<number> {
    return this.feedModule.incrTrendingScore(postId, delta, key);
  }

  async getTrendingRange(
    start: number,
    end: number,
    key = "trending:posts",
  ): Promise<string[]> {
    return this.feedModule.getTrendingRange(start, end, key);
  }

  async getTrendingCount(key = "trending:posts"): Promise<number> {
    return this.feedModule.getTrendingCount(key);
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
    return this.feedModule.getTrendingFeedWithCursor(limit, cursor, key);
  }

  async xPendingRange(
    stream: string,
    group: string,
    start = "-",
    end = "+",
    count = 1000,
  ): Promise<XPendingRangeEntry[]> {
    return this.streamModule.xPendingRange(stream, group, start, end, count);
  }

  async xClaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    ids: string[],
  ): Promise<XClaimReply> {
    return this.streamModule.xClaim(stream, group, consumer, minIdleMs, ids);
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.feedModule.zadd(key, score, member);
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.feedModule.zrem(key, member);
  }

  async zrangeByScore(
    key: string,
    min: string,
    max: string,
  ): Promise<string[]> {
    return this.feedModule.zrangeByScore(key, min, max);
  }

  async zremRangeByScore(
    key: string,
    min: string,
    max: string,
  ): Promise<number> {
    return this.feedModule.zremRangeByScore(key, min, max);
  }

  async markConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
    ttlSeconds: number,
  ): Promise<void> {
    return this.presenceModule.markConversationPresence(
      userId,
      conversationId,
      socketId,
      ttlSeconds,
    );
  }

  async clearConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
  ): Promise<void> {
    return this.presenceModule.clearConversationPresence(
      userId,
      conversationId,
      socketId,
    );
  }

  async isConversationActive(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
    return this.presenceModule.isConversationActive(userId, conversationId);
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    return this.feedModule.expire(key, seconds);
  }
}
