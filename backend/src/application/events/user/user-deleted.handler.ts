import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { UserBannedEvent, UserDeletedEvent } from "./user-interaction.event";
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
export class UserDeletedHandler
  implements IEventHandler<UserDeletedEvent | UserBannedEvent>
{
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: UserDeletedEvent | UserBannedEvent): Promise<void> {
    const isBan = event.type === EventRegistry.domain.UserBanned;
    const lifecycleAction = isBan ? "banned" : "deleted";
    const realtimeType = isBan
      ? EventRegistry.realtimeMessageTypes.userBanned
      : EventRegistry.realtimeMessageTypes.userDeleted;
    logger.info(
      `[UserDeletedHandler] User ${lifecycleAction}: ${event.userPublicId}, clearing cache entries`,
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
      tagsToInvalidate.push("who_to_follow");
      tagsToInvalidate.push(`user:${event.userPublicId}`);
      tagsToInvalidate.push(`user_data:${event.userPublicId}`);

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
      patternsToDelete.push(
        CacheKeyBuilder.getUserDataKey(event.userPublicId),
      );
      patternsToDelete.push(
        CacheKeyBuilder.getFollowingIdsKey(event.userPublicId),
      );

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

      const deletedPostPublicIds = event.deletedPostPublicIds ?? [];
      if (deletedPostPublicIds.length > 0) {
        await this.redis.removePostsFromFeedsBatch(
          [event.userPublicId, ...event.followerPublicIds],
          deletedPostPublicIds,
          "for_you",
        );
      }

      const affectedRelationshipPublicIds = [
        ...new Set(
          event.affectedRelationshipPublicIds ?? event.followerPublicIds,
        ),
      ];
      for (const affectedPublicId of affectedRelationshipPublicIds) {
        tagsToInvalidate.push(`user_profile:${affectedPublicId}`);
        tagsToInvalidate.push(`user:${affectedPublicId}`);
        tagsToInvalidate.push(`user_data:${affectedPublicId}`);
        patternsToDelete.push(`user:${affectedPublicId}:*`);
        patternsToDelete.push(`user_followers:${affectedPublicId}`);
        patternsToDelete.push(`user_following:${affectedPublicId}`);
        patternsToDelete.push(
          CacheKeyBuilder.getUserDataKey(affectedPublicId),
        );
        patternsToDelete.push(
          CacheKeyBuilder.getFollowingIdsKey(affectedPublicId),
        );
      }

      // invalidate global feeds that might contain user's posts
      tagsToInvalidate.push(CacheKeyBuilder.getTrendingFeedTag());
      tagsToInvalidate.push(CacheKeyBuilder.getNewFeedTag());
      patternsToDelete.push(CacheKeyBuilder.getTrendingFeedPattern());
      patternsToDelete.push(`${CacheKeyBuilder.PREFIXES.NEW_FEED}:*`);

      // perform cache invalidation
      const uniqueTagsToInvalidate = [...new Set(tagsToInvalidate)];
      const uniquePatternsToDelete = [...new Set(patternsToDelete)];
      logger.info(
        `[UserDeletedHandler] Invalidating ${uniqueTagsToInvalidate.length} tags`,
      );
      await this.redis.invalidateByTags(uniqueTagsToInvalidate);

      logger.info(
        `[UserDeletedHandler] Deleting ${uniquePatternsToDelete.length} patterns`,
      );
      await this.redis.deletePatterns(uniquePatternsToDelete);

      // publish event for real-time updates
      await this.redis.publish(
        EventRegistry.redisChannels.feedUpdates,
        JSON.stringify({
          eventId: buildRealtimeEventId(
            realtimeType,
            event.userPublicId,
          ),
          type: realtimeType,
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
      throw error;
    }
  }
}
