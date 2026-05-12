import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { ImageUploadedEvent } from "@/application/events/image/image.event";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ImageUploadHandler implements IEventHandler<ImageUploadedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private readonly userPreferenceRepository: UserPreferenceRepository,
  ) {}

  async handle(event: ImageUploadedEvent): Promise<void> {
    logger.info(
      `[IMAGE_UPLOAD_HANDLER] New image uploaded by ${event.uploaderPublicId}, invalidating relevant feeds`,
    );

    try {
      // use tag-based invalidation for efficient cache clearing
      const tagsToInvalidate: string[] = [];

      tagsToInvalidate.push(CacheKeyBuilder.getTrendingFeedTag());

      // invalidate uploader's own feeds
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserFeedTag(event.uploaderPublicId),
      );
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserForYouFeedTag(event.uploaderPublicId),
      );

      logger.info(
        `[IMAGE_UPLOAD_HANDLER] Getting followers for user: ${event.uploaderPublicId}`,
      );
      const followers = await this.getFollowersOfUser(event.uploaderPublicId);
      logger.info(`[IMAGE_UPLOAD_HANDLER] Found ${followers.length} followers`);

      // Get users interested in the image's tags
      logger.info(
        `[IMAGE_UPLOAD_HANDLER] Getting users interested in tags: ${event.tags.join(", ")}`,
      );
      const tagInterestedUsers = await this.getUsersInterestedInTags(
        event.tags,
      );
      logger.info(
        `[IMAGE_UPLOAD_HANDLER] Found ${tagInterestedUsers.length} users interested in tags`,
      );

      // Combine and deduplicate affected users
      const affectedUsers = [...new Set([...followers, ...tagInterestedUsers])];
      logger.info(
        `[IMAGE_UPLOAD_HANDLER] Total affected users: ${affectedUsers.length}`,
      );

      // Batch processing to prevent Redis pipeline overflow or event loop blocking
      const BATCH_SIZE = 500;

      if (affectedUsers.length > 0) {
        for (let i = 0; i < affectedUsers.length; i += BATCH_SIZE) {
          const batch = affectedUsers.slice(i, i + BATCH_SIZE);
          const batchTags: string[] = [];
          const batchPatterns: string[] = [];

          batch.forEach((userId) => {
            // Tags for invalidation
            batchTags.push(CacheKeyBuilder.getUserFeedTag(userId));
            batchTags.push(CacheKeyBuilder.getUserForYouFeedTag(userId));

            // Patterns for cleanup
            batchPatterns.push(...CacheKeyBuilder.getUserFeedPatterns(userId));
          });

          // Execute batch invalidation
          await this.redis.invalidateByTags(batchTags);
          await this.redis.deletePatterns(batchPatterns);

          // Publish real-time updates for this batch
          await this.redis.publish(
            "feed_updates",
            JSON.stringify({
              type: "new_image",
              uploaderId: event.uploaderPublicId,
              imageId: event.imageId,
              tags: event.tags,
              affectedUsers: batch,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      }

      // tag-based invalidation (primary)
      logger.info(
        `[IMAGE_UPLOAD_HANDLER] Invalidating cache with ${tagsToInvalidate.length} tags`,
      );
      await this.redis.invalidateByTags(tagsToInvalidate);

      // pattern-based cleanup (backup) for any keys without tag metadata
      const patterns = [
        ...CacheKeyBuilder.getUserFeedPatterns(event.uploaderPublicId),
        CacheKeyBuilder.getTrendingFeedPattern(),
        // do NOT clear new_feed - lazy refresh only
      ];

      await this.redis.deletePatterns(patterns);

      // do NOT publish global discovery feed update - new feed refreshes on-demand only

      logger.info(
        `[IMAGE_UPLOAD_HANDLER] Cache invalidation complete for new image upload`,
      );
    } catch (error) {
      console.error(
        "[IMAGE_UPLOAD_HANDLER] Error handling image upload:",
        error,
      );
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
      console.error(
        `[IMAGE_UPLOAD_HANDLER] Error getting followers for user ${userPublicId}:`,
        error,
      );
      return [];
    }
  }

  private async getUsersInterestedInTags(tags: string[]): Promise<string[]> {
    try {
      if (!tags || tags.length === 0) return [];
      const interestedUsers =
        await this.userPreferenceRepository.getUsersWithTagPreferences(tags);
      return interestedUsers.map((user) => user.publicId);
    } catch (error) {
      console.error(
        `[IMAGE_UPLOAD_HANDLER] Error getting users interested in tags ${tags.join(", ")}:`,
        error,
      );
      return [];
    }
  }
}
