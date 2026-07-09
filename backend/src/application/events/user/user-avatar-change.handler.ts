import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserAvatarChangedEvent } from "./user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class UserAvatarChangedHandler implements IEventHandler<UserAvatarChangedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: UserAvatarChangedEvent): Promise<void> {
    logger.info(
      `User ${event.userPublicId} changed avatar from "${event.oldAvatarUrl || "none"}" to "${event.newAvatarUrl}"`,
    );

    const avatarTags = [`user_data:${event.userPublicId}`];
    await this.redis.invalidateByTags(avatarTags);

    const followerTags = [CacheKeyBuilder.getUserFeedTag(event.userPublicId)];
    await this.redis.invalidateByTags(followerTags);

    await this.redis.publish(
      EventRegistry.redisChannels.feedUpdates,
      JSON.stringify({
        eventId: buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.avatarChanged,
          event.userPublicId,
          event.timestamp.toISOString(),
        ),
        type: EventRegistry.realtimeMessageTypes.avatarChanged,
        userId: event.userPublicId,
        oldAvatar: event.oldAvatarUrl,
        newAvatar: event.newAvatarUrl,
        timestamp: event.timestamp.toISOString(),
      }),
    );

    await this.redis.publish(EventRegistry.redisChannels.profileSnapshotUpdates, {
      type: EventRegistry.realtimeMessageTypes.avatarChanged,
      userPublicId: event.userPublicId,
      avatarUrl: event.newAvatarUrl ?? "",
      timestamp: event.timestamp.toISOString(),
    });

    logger.info(
      `Smart cache invalidation completed for avatar change of user ${event.userPublicId}`,
    );
  }
}
