import { UserPublicId } from "@/types/branded";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { PostUploadedEvent } from "@/application/events/post/post.event";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { UserActivityService } from "@/services/user-activity.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class PostUploadHandler implements IEventHandler<PostUploadedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postRepository: IPostReadRepository,
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
      const [author, post] = await Promise.all([
        this.userRepository.findByPublicId(event.authorPublicId),
        this.postRepository.findByPublicId(event.postId),
      ]);
      if (!author || author.isBanned || !post) {
        logger.info(
          "[POST_UPLOAD_HANDLER] Skipping stale event for an unavailable author or post",
          {
            authorPublicId: event.authorPublicId,
            postPublicId: event.postId,
          },
        );
        return;
      }

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

      const feedRecipients = [
        ...new Set([event.authorPublicId, ...affectedUsers]),
      ];
      if (feedRecipients.length > 0) {
        await this.redis.addToFeedsBatch(
          feedRecipients,
          event.postId,
          event.timestamp.getTime(),
          "for_you",
        );
        logger.info(
          `[POST_UPLOAD_HANDLER] Materialized for_you feed for ${feedRecipients.length} users`,
        );
      }

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
          EventRegistry.redisChannels.feedUpdates,
          JSON.stringify({
            eventId: buildRealtimeEventId(
              EventRegistry.realtimeMessageTypes.newPost,
              event.postId,
            ),
            type: EventRegistry.realtimeMessageTypes.newPost,
            authorId: event.authorPublicId,
            postId: event.postId,
            tags: event.tags,
            affectedUsers,
            timestamp: event.timestamp.toISOString(),
          }),
        );
      }

      // do NOT publish global discovery feed update - new feed refreshes on-demand only
      // this prevents the "super fast train" effect where new feed updates constantly

      const auxiliaryResults = await Promise.allSettled([
        this.userActivityService.trackPostCreated(event.authorPublicId),
        this.redis.invalidateByTags(["who_to_follow"]),
      ]);
      for (const result of auxiliaryResults) {
        if (result.status === "rejected") {
          logger.warn("[POST_UPLOAD_HANDLER] Auxiliary update failed", {
            error: result.reason,
          });
        }
      }

      logger.info(
        `[POST_UPLOAD_HANDLER] Cache invalidation complete for new post`,
      );
    } catch (error) {
      logger.error("[POST_UPLOAD_HANDLER] Error handling post upload", {
        error,
      });
      // Fallback: invalidate all feed patterns (except new_feed)
      const fallbackPatterns = CacheKeyBuilder.getGlobalFeedPatterns();
      await this.redis.deletePatterns(fallbackPatterns).catch((fallbackError) => {
        logger.error("[POST_UPLOAD_HANDLER] Fallback invalidation failed", {
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
      logger.error(
        `[POST_UPLOAD_HANDLER] Error getting followers for user ${userPublicId}`,
        { error },
      );
      throw error;
    }
  }

  private async getUsersInterestedInTags(tags: string[]): Promise<string[]> {
    try {
      if (!tags || tags.length === 0) return [];
      const interestedUsers =
        await this.userPreferenceRepository.getUsersWithTagPreferences(tags);
      return interestedUsers.map((user) => user.publicId);
    } catch (error) {
      logger.error(
        `[POST_UPLOAD_HANDLER] Error getting users interested in tags ${tags.join(", ")}`,
        { error },
      );
      throw error;
    }
  }
}
