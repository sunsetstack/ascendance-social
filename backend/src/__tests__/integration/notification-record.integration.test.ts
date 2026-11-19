import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import mongoose from "mongoose";
import { createClient, type RedisClientType } from "redis";
import Notification from "@/models/notification.model";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisNotificationModule } from "@/services/redis/redis-notification.module";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { asUserPublicId, asMongoId } from "@/types/branded";
import { requireNotificationRecord } from "@/utils/notification-plain";

const uri = process.env.INTEGRATION_MONGODB_URI;
const redisUrl = process.env.INTEGRATION_REDIS_URL;
const databaseName = `asc_notification_${randomUUID().replaceAll("-", "")}`;
(uri && redisUrl ? describe : describe.skip)(
  "Notification record boundaries",
  function () {
    this.timeout(30_000);
    const user = asUserPublicId(randomUUID());
    let redis: RedisClientType;
    before(async () => {
      await mongoose.connect(uri!, { dbName: databaseName });
      await Notification.init();
      redis = createClient({ url: redisUrl });
      await redis.connect();
    });
    after(async () => {
      try {
        if (redis?.isOpen) await redis.quit();
        if (mongoose.connection.name === databaseName)
          await mongoose.connection.dropDatabase();
      } finally {
        await mongoose.disconnect();
      }
    });

    it("returns the same canonical records from MongoDB and a backfilled Redis cache", async () => {
      const repository = new NotificationRepository(Notification);
      await repository.create({
        userId: user,
        actorId: asUserPublicId(randomUUID()),
        actionType: "follow",
      });
      const records = await repository.getNotifications(user);
      expect(records).to.have.length(1);
      expect(records[0]!.id).to.be.a("string");
      expect(records[0]).not.to.have.property("$__");
      const cache = new RedisNotificationModule(redis);
      await cache.backfillNotifications(user, records);
      expect(await cache.getUserNotifications(user)).to.deep.equal(records);
      expect(
        await repository.getNotificationsBeforeTimestamp(
          user,
          new Date(Date.now() + 1000),
        ),
      ).to.deep.equal(records);
      const updated = await repository.markAsRead(
        asMongoId(records[0]!.id),
        user,
      );
      expect(String(updated?._id)).to.equal(records[0]!.id);
      expect(requireNotificationRecord(updated).isRead).to.equal(true);
      await cache.markNotificationRead(records[0]!.id);
      expect(await cache.getUserNotifications(user)).to.deep.equal(
        await repository.getNotifications(user),
      );
    });

    it("ignores malformed cached records instead of returning empty notification objects", async () => {
      const listKey = CacheKeyBuilder.getNotificationListKey(user);
      await redis.del(listKey);
      const hashKey = CacheKeyBuilder.getNotificationHashKey("malformed");
      await redis.hSet(hashKey, {
        data: "{}",
        isRead: "0",
        timestamp: String(Date.now()),
      });
      await redis.lPush(listKey, "malformed");
      expect(
        await new RedisNotificationModule(redis).getUserNotifications(user),
      ).to.deep.equal([]);
    });
  },
);
