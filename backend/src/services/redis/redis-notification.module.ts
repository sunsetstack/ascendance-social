import { randomUUID } from "node:crypto";
import { RedisClientType } from "redis";
import type { NotificationRecord } from "@/types/customNotifications/notifications.types";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { requireNotificationRecord } from "@/utils/notification-plain";

const BACKFILL_TIMEOUT_SECONDS = 15;
const SNAPSHOT_TTL_SECONDS = 60;

const STORE_SNAPSHOT_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
end
`;

export class RedisNotificationModule {
  constructor(private readonly client: RedisClientType) {}

  async clearNotificationCaches(
    userIds: string[],
    notificationIds: string[] = [],
  ): Promise<void> {
    const keys = [
      ...userIds.map(CacheKeyBuilder.getNotificationSnapshotKey),
      ...(notificationIds.length > 0
        ? userIds.map((id) => CacheKeyBuilder.getNotificationListKey(id))
        : []),
      ...notificationIds.map((id) => CacheKeyBuilder.getNotificationHashKey(id)),
    ];
    for (let offset = 0; offset < keys.length; offset += 500) {
      await this.client.del(keys.slice(offset, offset + 500));
    }
  }

  async getUserNotifications(userId: string): Promise<NotificationRecord[] | null> {
    const value = await this.client.get(CacheKeyBuilder.getNotificationSnapshotKey(userId));
    if (!value?.startsWith("[")) return null;
    return (JSON.parse(value) as unknown[]).map(requireNotificationRecord);
  }

  async beginNotificationBackfill(userId: string): Promise<string | null> {
    const token = randomUUID();
    const result = await this.client.set(
      CacheKeyBuilder.getNotificationSnapshotKey(userId),
      token,
      { NX: true, EX: BACKFILL_TIMEOUT_SECONDS },
    );
    return result === "OK" ? token : null;
  }

  async backfillNotifications(
    userId: string,
    token: string,
    notifications: NotificationRecord[],
  ): Promise<void> {
    await this.client.eval(STORE_SNAPSHOT_SCRIPT, {
      keys: [CacheKeyBuilder.getNotificationSnapshotKey(userId)],
      arguments: [token, JSON.stringify(notifications), String(SNAPSHOT_TTL_SECONDS)],
    });
  }
}
