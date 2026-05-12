import { RedisClientType } from "redis";
import { performance } from "perf_hooks";
import { INotification } from "@/types";
import { NotificationPlain } from "@/types/customNotifications/notifications.types";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { normalizeNotificationPlain } from "@/utils/notification-plain";
import { redisLogger } from "@/utils/winston";

/**
 * Minimal required fields from a Redis notification hash.
 * The `data` field holds the full JSON-serialised notification.
 */
interface NotificationHash {
  data: string;
  isRead: string;
  timestamp: string;
}

function isNotificationHash(val: unknown): val is NotificationHash {
  return (
    typeof val === "object" &&
    val !== null &&
    "data" in val &&
    typeof (val as Record<string, unknown>).data === "string"
  );
}

export class RedisNotificationModule {
  constructor(private readonly client: RedisClientType) {}

  async pushNotification(
    userId: string,
    notification: INotification,
    maxCount = 200,
  ): Promise<void> {
    const listKey = CacheKeyBuilder.getNotificationListKey(userId);
    const notificationId = String(notification._id);
    const hashKey = CacheKeyBuilder.getNotificationHashKey(notificationId);

    const start = performance.now();
    const pipeline = this.client.multi();
    pipeline.hSet(hashKey, {
      data: JSON.stringify(notification),
      isRead: notification.isRead ? "1" : "0",
      timestamp: String(notification.timestamp),
    });
    pipeline.expire(hashKey, 2592000);
    pipeline.lPush(listKey, notificationId);
    pipeline.lTrim(listKey, 0, maxCount - 1);
    pipeline.expire(listKey, 2592000);
    await pipeline.exec();

    const durationMs = performance.now() - start;
    redisLogger.info(
      `[Redis] pushNotification userId=${userId} notification=${notificationId} duration=${durationMs.toFixed(2)}ms`,
    );
  }

  async backfillNotifications(
    userId: string,
    notifications: INotification[],
    maxCount = 200,
  ): Promise<void> {
    const listKey = CacheKeyBuilder.getNotificationListKey(userId);
    const start = performance.now();

    await this.client.del(listKey);
    const pipeline = this.client.multi();

    for (const notification of notifications) {
      const notificationId = String(notification._id);
      const hashKey = CacheKeyBuilder.getNotificationHashKey(notificationId);

      pipeline.hSet(hashKey, {
        data: JSON.stringify(notification),
        isRead: notification.isRead ? "1" : "0",
        timestamp: String(notification.timestamp),
      });
      pipeline.expire(hashKey, 2592000);
      pipeline.rPush(listKey, notificationId);
    }

    pipeline.lTrim(listKey, 0, maxCount - 1);
    pipeline.expire(listKey, 2592000);
    await pipeline.exec();

    const durationMs = performance.now() - start;
    redisLogger.info("Backfilled notifications cache", {
      userId,
      count: notifications.length,
      duration: durationMs.toFixed(2),
    });
  }

  async getUserNotifications(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<NotificationPlain[]> {
    const listKey = CacheKeyBuilder.getNotificationListKey(userId);
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const startPerf = performance.now();

    redisLogger.debug("getUserNotifications called", {
      userId,
      page,
      limit,
      listKey,
    });

    try {
      const notificationIds = await this.client.lRange(listKey, start, end);
      redisLogger.debug("lRange result", {
        userId,
        idCount: notificationIds.length,
      });

      if (notificationIds.length === 0) {
        redisLogger.info("No notifications in Redis list", { userId });
        return [];
      }

      const pipeline = this.client.multi();
      for (const id of notificationIds) {
        pipeline.hGetAll(CacheKeyBuilder.getNotificationHashKey(id));
      }
      // pipeline.exec() returns an array matching the commands issued.
      // Each hGetAll yields Record<string, string> | null.
      const results = (await pipeline.exec()) as (Record<string, string> | null)[];

      if (!results) {
        redisLogger.warn("Pipeline returned null results", { userId });
        return [];
      }

      const notifications: NotificationPlain[] = results
        .map((raw): NotificationPlain | null => {
          if (!isNotificationHash(raw)) return null;
          try {
            const parsed: unknown = JSON.parse(raw.data);
            const notification = normalizeNotificationPlain(parsed);
            if (!notification) return null;
            notification.isRead = raw.isRead === "1";
            return notification;
          } catch {
            return null;
          }
        })
        .filter((n): n is NotificationPlain => n !== null);

      const duration = performance.now() - startPerf;
      redisLogger.info("getUserNotifications success", {
        userId,
        returned: notifications.length,
        duration,
      });
      return notifications;
    } catch (error) {
      redisLogger.error("getUserNotifications failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getUserNotificationIds(
    userId: string,
    start = 0,
    end = -1,
  ): Promise<string[]> {
    return this.client.lRange(
      CacheKeyBuilder.getNotificationListKey(userId),
      start,
      end,
    );
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.client.hSet(
      CacheKeyBuilder.getNotificationHashKey(notificationId),
      "isRead",
      "1",
    );
  }

  async markNotificationsRead(notificationIds: string[]): Promise<void> {
    if (notificationIds.length === 0) return;

    const pipeline = this.client.multi();
    for (const id of notificationIds) {
      pipeline.hSet(CacheKeyBuilder.getNotificationHashKey(id), "isRead", "1");
    }
    await pipeline.exec();
  }

  async getUnreadNotificationCount(userId: string): Promise<number> {
    const listKey = CacheKeyBuilder.getNotificationListKey(userId);
    try {
      const notificationIds = await this.client.lRange(listKey, 0, -1);

      const pipeline = this.client.multi();
      for (const id of notificationIds) {
        pipeline.hGet(CacheKeyBuilder.getNotificationHashKey(id), "isRead");
      }
      const results = await pipeline.exec();

      let unreadCount = 0;
      for (const result of results) {
        if (result === "0") unreadCount++;
      }
      return unreadCount;
    } catch (error) {
      redisLogger.error("getUnreadNotificationCount failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
