import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class PostDeleteHandler implements IEventHandler<PostDeletedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: PostDeletedEvent): Promise<void> {
    logger.info(
      `Post deleted: ${event.postId} by ${event.authorPublicId}, invalidating relevant feeds`,
    );

    try {
      const tagsToInvalidate = [CacheKeyBuilder.getTrendingFeedTag()];

      tagsToInvalidate.push(`user_post_count:${event.authorPublicId}`);
      tagsToInvalidate.push(CacheKeyBuilder.getNewFeedTag());
      tagsToInvalidate.push(CacheKeyBuilder.getPostMetaKey(event.postId));

      logger.info(`Invalidating cache with ${tagsToInvalidate.length} tags`);
      await this.redis.invalidateByTags(tagsToInvalidate);

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
}
