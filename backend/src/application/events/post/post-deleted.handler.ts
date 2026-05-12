import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

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

      const followers = await this.getFollowersOfUser(event.authorPublicId);
      if (followers.length > 0) {
        logger.info(`Invalidating feeds for ${followers.length} followers`);
        followers.forEach((publicId) => {
          tagsToInvalidate.push(CacheKeyBuilder.getUserFeedTag(publicId));
          tagsToInvalidate.push(CacheKeyBuilder.getUserForYouFeedTag(publicId));
        });
      }

      logger.info(`Invalidating cache with ${tagsToInvalidate.length} tags`);
      await this.redis.invalidateByTags(tagsToInvalidate);

      const patterns = [
        ...CacheKeyBuilder.getUserFeedPatterns(event.authorPublicId),
        CacheKeyBuilder.getTrendingFeedPattern(),
        // do NOT clear new_feed - lazy refresh only
      ];

      followers.forEach((publicId) => {
        patterns.push(...CacheKeyBuilder.getUserFeedPatterns(publicId));
      });

      await this.redis.deletePatterns(patterns);

      await this.redis.publish(
        "feed_updates",
        JSON.stringify({
          type: "post_deleted",
          postId: event.postId,
          authorId: event.authorPublicId,
          timestamp: new Date().toISOString(),
        }),
      );

      logger.info(`Feed invalidation complete for post deletion`);
    } catch (error) {
      console.error("Error handling post deletion:", error);
      const fallbackPatterns = CacheKeyBuilder.getGlobalFeedPatterns();
      await this.redis.deletePatterns(fallbackPatterns);
    }
  }

  private async getFollowersOfUser(userPublicId: string): Promise<string[]> {
    try {
      const followers =
        await this.userRepository.findUsersFollowing(userPublicId);
      return followers.map((user) => user.publicId);
    } catch (error) {
      console.error(`Error getting followers for user ${userPublicId}:`, error);
      return [];
    }
  }
}
