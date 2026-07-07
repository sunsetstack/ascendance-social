import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserUsernameChangedEvent } from "./user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { EventRegistry } from "@/application/common/events/event-registry";

@injectable()
export class UserUsernameChangedHandler implements IEventHandler<UserUsernameChangedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: UserUsernameChangedEvent): Promise<void> {
    logger.info(
      `User ${event.userPublicId} changed username from "${event.oldUsername}" to "${event.newUsername}"`,
    );

    try {
      // invalidate user data caches
      const userTags = [`user_data:${event.userPublicId}`];
      await this.redis.invalidateByTags(userTags);

      // invalidate feed caches that might contain old username
      const feedTags = [CacheKeyBuilder.getUserFeedTag(event.userPublicId)];
      await this.redis.invalidateByTags(feedTags);

      // publish to profile_snapshot_updates channel for background worker to update embedded author snapshots in posts
      await this.redis.publish(EventRegistry.redisChannels.profileSnapshotUpdates, {
        type: EventRegistry.socketPayloadTypes.usernameChanged,
        userPublicId: event.userPublicId,
        username: event.newUsername,
        timestamp: event.timestamp.toISOString(),
      });

      logger.info(
        `Cache invalidation completed for username change of user ${event.userPublicId}`,
      );
    } catch (error) {
      logger.error(
        `Error while handling username change for user ${event.userPublicId}`,
        { error },
      );
    }
  }
}
