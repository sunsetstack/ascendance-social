import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { PostUploadedEvent } from "@/application/events/post/post.event";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { UserActivityService } from "@/services/user-activity.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostUploadHandler implements IEventHandler<PostUploadedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private readonly userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Services.UserActivity)
    private readonly userActivityService: UserActivityService,
  ) {}

  async handle(event: PostUploadedEvent): Promise<void> {
    logger.info(
      `[POST_UPLOAD_HANDLER] New post created by ${event.authorPublicId}, invalidating relevant feeds`,
    );

    try {
      // track user activity for who-to-follow adaptive logic (fire and forget)
      this.userActivityService
        .trackPostCreated(event.authorPublicId)
        .catch((err) => {
          logger.warn(
            "[POST_UPLOAD_HANDLER] Failed to track user activity",
            err,
          );
        });

      // invalidate who-to-follow cache since we have a new user posting
      // this ensures the new user appears in suggestions
      this.redis.invalidateByTags(["who_to_follow"]).catch((err) => {
        logger.warn(
          "[POST_UPLOAD_HANDLER] Failed to invalidate who-to-follow cache",
          err,
        );
      });

      // use tag-based invalidation for efficient cache clearing
      const tagsToInvalidate: string[] = [];

      // invalidate author's own feeds and metrics
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserFeedTag(event.authorPublicId),
      );
      tagsToInvalidate.push(
        CacheKeyBuilder.getUserForYouFeedTag(event.authorPublicId),
      );
      tagsToInvalidate.push(`user_post_count:${event.authorPublicId}`);

      logger.info(
        `[POST_UPLOAD_HANDLER] Getting followers for user: ${event.authorPublicId}`,
      );
      const followers = await this.getFollowersOfUser(event.authorPublicId);
      logger.info(`[POST_UPLOAD_HANDLER] Found ${followers.length} followers`);

      // Get users interested in the post's tags
      logger.info(
        `[POST_UPLOAD_HANDLER] Getting users interested in tags: ${event.tags.join(", ")}`,
      );
      const tagInterestedUsers = await this.getUsersInterestedInTags(
        event.tags,
      );
      logger.info(
        `[POST_UPLOAD_HANDLER] Found ${tagInterestedUsers.length} users interested in tags`,
      );

      // Combine and deduplicate affected users
      const affectedUsers = [...new Set([...followers, ...tagInterestedUsers])];
      logger.info(
        `[POST_UPLOAD_HANDLER] Total affected users: ${affectedUsers.length}`,
      );

      if (affectedUsers.length > 0) {
        // invalidate affected users' feeds using tags
        affectedUsers.forEach((userId) => {
          tagsToInvalidate.push(CacheKeyBuilder.getUserFeedTag(userId));
          tagsToInvalidate.push(CacheKeyBuilder.getUserForYouFeedTag(userId));
        });
      }

      // tag-based invalidation (primary)
      logger.info(
        `[POST_UPLOAD_HANDLER] Invalidating cache with ${tagsToInvalidate.length} tags`,
      );
      await this.redis.invalidateByTags(tagsToInvalidate);

      // fallback cleanup for keys without tag metadata
      const patterns = [
        ...CacheKeyBuilder.getUserFeedPatterns(event.authorPublicId),
        CacheKeyBuilder.getTrendingFeedPattern(),
        `${CacheKeyBuilder.getTrendingTagsPrefix()}:*`, // Invalidate trending tags
        // do NOT clear new_feed - lazy refresh only
      ];

      affectedUsers.forEach((userId) => {
        patterns.push(...CacheKeyBuilder.getUserFeedPatterns(userId));
      });

      await this.redis.deletePatterns(patterns);

      // Publish real-time feed update for WebSocket notifications
      if (affectedUsers.length > 0) {
        await this.redis.publish(
          "feed_updates",
          JSON.stringify({
            type: "new_post",
            authorId: event.authorPublicId,
            postId: event.postId,
            tags: event.tags,
            affectedUsers,
            timestamp: new Date().toISOString(),
          }),
        );
      }

      // do NOT publish global discovery feed update - new feed refreshes on-demand only
      // this prevents the "super fast train" effect where new feed updates constantly

      logger.info(
        `[POST_UPLOAD_HANDLER] Cache invalidation complete for new post`,
      );
    } catch (error) {
      console.error("[POST_UPLOAD_HANDLER] Error handling post upload:", error);
      // Fallback: invalidate all feed patterns (except new_feed)
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
        `[POST_UPLOAD_HANDLER] Error getting followers for user ${userPublicId}:`,
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
        `[POST_UPLOAD_HANDLER] Error getting users interested in tags ${tags.join(", ")}:`,
        error,
      );
      return [];
    }
  }
}
