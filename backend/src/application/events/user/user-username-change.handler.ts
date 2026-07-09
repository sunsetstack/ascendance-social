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

    const userTags = [`user_data:${event.userPublicId}`];
    await this.redis.invalidateByTags(userTags);

    const feedTags = [CacheKeyBuilder.getUserFeedTag(event.userPublicId)];
    await this.redis.invalidateByTags(feedTags);

    await this.redis.publish(EventRegistry.redisChannels.profileSnapshotUpdates, {
      type: EventRegistry.socketPayloadTypes.usernameChanged,
      userPublicId: event.userPublicId,
      username: event.newUsername,
      timestamp: event.timestamp.toISOString(),
    });

    logger.info(
      `Cache invalidation completed for username change of user ${event.userPublicId}`,
    );
  }
}
