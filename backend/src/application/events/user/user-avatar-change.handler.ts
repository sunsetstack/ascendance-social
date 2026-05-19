import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserAvatarChangedEvent } from "./user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UserAvatarChangedHandler implements IEventHandler<UserAvatarChangedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: UserAvatarChangedEvent): Promise<void> {
    logger.info(
      `User ${event.userPublicId} changed avatar from "${event.oldAvatarUrl || "none"}" to "${event.newAvatarUrl}"`,
    );

    try {
      // Smart invalidation: only invalidate user data caches that contain this user's avatar
      const avatarTags = [`user_data:${event.userPublicId}`];
      await this.redis.invalidateByTags(avatarTags);

      const followerTags = [CacheKeyBuilder.getUserFeedTag(event.userPublicId)]; // User's own feed
      await this.redis.invalidateByTags(followerTags);

      // Publish real-time avatar update for connected clients
      await this.redis.publish(
        "feed_updates",
        JSON.stringify({
          type: "avatar_changed",
          userId: event.userPublicId,
          oldAvatar: event.oldAvatarUrl,
          newAvatar: event.newAvatarUrl,
          timestamp: new Date().toISOString(),
        }),
      );

      // Publish to profile_snapshot_updates channel for background worker to update embedded author snapshots in posts
      await this.redis.publish("profile_snapshot_updates", {
        type: "avatar_changed",
        userPublicId: event.userPublicId,
        avatarUrl: event.newAvatarUrl ?? "",
        timestamp: new Date().toISOString(),
      });

      logger.info(
        `Smart cache invalidation completed for avatar change of user ${event.userPublicId}`,
      );
    } catch (error) {
      logger.error(
        `Error while handling avatar change for user ${event.userPublicId}`,
        { error },
      );

      // Fallback: try to clear all relevant user caches
      try {
        const tags = [
          `user_data:${event.userPublicId}`,
          CacheKeyBuilder.getUserFeedTag(event.userPublicId),
          CacheKeyBuilder.getUserForYouFeedTag(event.userPublicId),
        ];
        await this.redis.invalidateByTags(tags);
        logger.info(
          `Fallback: Cleared specific user Redis caches due to error`,
        );
      } catch (fallbackError) {
        logger.error("Fallback cache clear failed", { fallbackError });
      }
    }
  }
}
