import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { ImageDeletedEvent } from "./image.event";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ImageDeleteHandler implements IEventHandler<ImageDeletedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
  ) {}

  async handle(event: ImageDeletedEvent): Promise<void> {
    logger.info(
      `Image deleted: ${event.imageId} by ${event.uploaderPublicId}, invalidating relevant feeds`,
    );

    try {
      // use tag-based invalidation for active cache entries
      const tagsToInvalidate: string[] = [];

      tagsToInvalidate.push(CacheKeyBuilder.getTrendingFeedTag());

      // invalidate uploader's personalized feeds
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserFeedTag(event.uploaderPublicId),
      );
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserForYouFeedTag(event.uploaderPublicId),
      );

      // get followers and invalidate their feeds
      const followers = await this.getFollowersOfUser(event.uploaderPublicId);
      if (followers.length > 0) {
        logger.info(`Invalidating feeds for ${followers.length} followers`);
        followers.forEach((publicId) => {
          tagsToInvalidate.push(CacheKeyBuilder.getUserFeedTag(publicId));
          tagsToInvalidate.push(CacheKeyBuilder.getUserForYouFeedTag(publicId));
        });
      }

      // use tag-based invalidation (efficient - only deletes keys with these tags)
      logger.info(`Invalidating cache with ${tagsToInvalidate.length} tags`);
      await this.redis.invalidateByTags(tagsToInvalidate);

      // also do pattern-based cleanup for any keys that might not have tag metadata
      // (e.g., if tags expired but cache keys haven't yet)
      const patterns = [
        ...CacheKeyBuilder.getUserFeedPatterns(event.uploaderPublicId),
        CacheKeyBuilder.getTrendingFeedPattern(),
        // do NOT clear new_feed - lazy refresh only
      ];

      // add follower patterns
      followers.forEach((publicId) => {
        patterns.push(...CacheKeyBuilder.getUserFeedPatterns(publicId));
      });

      await this.redis.deletePatterns(patterns);

      logger.info(`Feed invalidation complete for image deletion`);
    } catch (error) {
      console.error("Error handling image deletion:", error);
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
