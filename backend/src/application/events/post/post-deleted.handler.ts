import { UserPublicId } from "@/types/branded";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class PostDeleteHandler implements IEventHandler<PostDeletedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
  ) {}

  async handle(event: PostDeletedEvent): Promise<void> {
    logger.info(
      `Post deleted: ${event.postId} by ${event.authorPublicId}, invalidating relevant feeds`,
    );

    try {
      const tagsToInvalidate: string[] = [];

      tagsToInvalidate.push(CacheKeyBuilder.getTrendingFeedTag());
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserFeedTag(event.authorPublicId),
      );
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserForYouFeedTag(event.authorPublicId),
      );
      tagsToInvalidate.push(`user_post_count:${event.authorPublicId}`);
      tagsToInvalidate.push(CacheKeyBuilder.getNewFeedTag());
      tagsToInvalidate.push(CacheKeyBuilder.getPostMetaKey(event.postId));

      const followers = await this.getFollowersOfUser(event.authorPublicId);
      if (followers.length > 0) {
        logger.info(`Invalidating feeds for ${followers.length} followers`);
        followers.forEach((publicId) => {
          tagsToInvalidate.push(CacheKeyBuilder.getUserFeedTag(publicId));
          tagsToInvalidate.push(CacheKeyBuilder.getUserForYouFeedTag(publicId));
        });
      }

      await this.redis.removeFromFeedsBatch(
        [event.authorPublicId, ...followers],
        event.postId,
        "for_you",
      );

      logger.info(`Invalidating cache with ${tagsToInvalidate.length} tags`);
      await this.redis.invalidateByTags(tagsToInvalidate);

      const patterns = [
        ...CacheKeyBuilder.getGlobalFeedPatterns(true),
        ...CacheKeyBuilder.getUserFeedPatterns(event.authorPublicId),
      ];

      followers.forEach((publicId) => {
        patterns.push(...CacheKeyBuilder.getUserFeedPatterns(publicId));
      });

      await this.redis.deletePatterns([...new Set(patterns)]);
      await this.redis.zrem("trending:posts", event.postId);

      await this.redis.publish(
        EventRegistry.redisChannels.feedUpdates,
        JSON.stringify({
          eventId: buildRealtimeEventId(
            EventRegistry.realtimeMessageTypes.postDeleted,
            event.postId,
          ),
          type: EventRegistry.realtimeMessageTypes.postDeleted,
          postId: event.postId,
          authorId: event.authorPublicId,
          timestamp: event.timestamp.toISOString(),
        }),
      );

      logger.info(`Feed invalidation complete for post deletion`);
    } catch (error) {
      logger.error("Error handling post deletion", { error });
      const fallbackPatterns = CacheKeyBuilder.getGlobalFeedPatterns();
      await this.redis.deletePatterns(fallbackPatterns).catch((fallbackError) => {
        logger.error("Post deletion fallback invalidation failed", {
          fallbackError,
        });
      });
      throw error;
    }
  }

  private async getFollowersOfUser(
    userPublicId: UserPublicId,
  ): Promise<string[]> {
    try {
      const followers =
        await this.userRepository.findUsersFollowing(userPublicId);
      return followers.map((user) => user.publicId);
    } catch (error) {
      logger.error(`Error getting followers for user ${userPublicId}`, {
        error,
      });
      throw error;
    }
  }
}
