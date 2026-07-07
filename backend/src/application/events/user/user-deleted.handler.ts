import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { UserDeletedEvent } from "./user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

/**
 * Handles cache cleanup when a user is deleted
 * clears all user-related cache entries including feeds, notifications, posts, etc
 */
@injectable()
export class UserDeletedHandler implements IEventHandler<UserDeletedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: UserDeletedEvent): Promise<void> {
    logger.info(
      `[UserDeletedHandler] User deleted: ${event.userPublicId}, clearing cache entries`,
    );

    try {
      const tagsToInvalidate: string[] = [];
      const patternsToDelete: string[] = [];

      // user's own feed tags
      tagsToInvalidate.push(CacheKeyBuilder.getUserFeedTag(event.userPublicId));
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserForYouFeedTag(event.userPublicId),
      );
      tagsToInvalidate.push(`user_post_count:${event.userPublicId}`);
      tagsToInvalidate.push(`user_profile:${event.userPublicId}`);

      // user's cache patterns
      patternsToDelete.push(
        ...CacheKeyBuilder.getUserFeedPatterns(event.userPublicId),
      );
      patternsToDelete.push(`user:${event.userPublicId}:*`);
      patternsToDelete.push(`notifications:${event.userPublicId}:*`);
      patternsToDelete.push(`notification_count:${event.userPublicId}`);
      patternsToDelete.push(`user_preferences:${event.userPublicId}`);
      patternsToDelete.push(`user_posts:${event.userPublicId}:*`);
      patternsToDelete.push(`user_likes:${event.userPublicId}:*`);
      patternsToDelete.push(`user_favorites:${event.userPublicId}:*`);
      patternsToDelete.push(`user_followers:${event.userPublicId}`);
      patternsToDelete.push(`user_following:${event.userPublicId}`);

      // clear followers' feeds since they followed this user
      if (event.followerPublicIds.length > 0) {
        logger.info(
          `[UserDeletedHandler] Invalidating feeds for ${event.followerPublicIds.length} followers`,
        );
        for (const followerPublicId of event.followerPublicIds) {
          tagsToInvalidate.push(
            CacheKeyBuilder.getUserFeedTag(followerPublicId),
          );
          tagsToInvalidate.push(
            CacheKeyBuilder.getUserForYouFeedTag(followerPublicId),
          );
          patternsToDelete.push(
            ...CacheKeyBuilder.getUserFeedPatterns(followerPublicId),
          );
        }
      }

      // invalidate global feeds that might contain user's posts
      tagsToInvalidate.push(CacheKeyBuilder.getTrendingFeedTag());
      patternsToDelete.push(CacheKeyBuilder.getTrendingFeedPattern());
      patternsToDelete.push(`${CacheKeyBuilder.PREFIXES.NEW_FEED}:*`);

      // perform cache invalidation
      logger.info(
        `[UserDeletedHandler] Invalidating ${tagsToInvalidate.length} tags`,
      );
      await this.redis.invalidateByTags(tagsToInvalidate);

      logger.info(
        `[UserDeletedHandler] Deleting ${patternsToDelete.length} patterns`,
      );
      await this.redis.deletePatterns(patternsToDelete);

      // publish event for real-time updates
      await this.redis.publish(
        EventRegistry.redisChannels.feedUpdates,
        JSON.stringify({
          eventId: buildRealtimeEventId(
            EventRegistry.realtimeMessageTypes.userDeleted,
            event.userPublicId,
          ),
          type: EventRegistry.realtimeMessageTypes.userDeleted,
          userPublicId: event.userPublicId,
          timestamp: event.timestamp.toISOString(),
        }),
      );

      logger.info(
        `[UserDeletedHandler] Cache cleanup complete for user ${event.userPublicId}`,
      );
    } catch (error) {
      logger.error(
        `[UserDeletedHandler] Error clearing cache for user ${event.userPublicId}`,
        { error },
      );
      // fallback: clear broad patterns to ensure stale data doesn't persist
      try {
        const fallbackPatterns = [
          `*:${event.userPublicId}:*`,
          `*:${event.userPublicId}`,
          CacheKeyBuilder.getTrendingFeedPattern(),
          `${CacheKeyBuilder.PREFIXES.NEW_FEED}:*`,
        ];
        await this.redis.deletePatterns(fallbackPatterns);
      } catch (fallbackError) {
        logger.error(`[UserDeletedHandler] Fallback cleanup also failed`, {
          fallbackError,
        });
      }
    }
  }
}
