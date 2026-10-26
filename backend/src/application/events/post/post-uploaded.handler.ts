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

      const tagsToInvalidate = [
        CacheKeyBuilder.getTrendingFeedTag(),
        CacheKeyBuilder.getTrendingTagsTag(),
        `user_post_count:${event.authorPublicId}`,
      ];

      const followers = await this.userRepository.findUsersFollowing(
        event.authorPublicId,
      );
      const tagInterestedUsers = event.tags.length
        ? await this.userPreferenceRepository.getUsersWithTagPreferences(event.tags)
        : [];
      const affectedUsers = [
        ...new Set([...followers, ...tagInterestedUsers].map((user) => user.publicId)),
      ];

      await this.redis.invalidateByTags(tagsToInvalidate);

      // Retain namespace cleanup until untagged Trending Tags entries expire.
      await this.redis.deletePatterns([
        `${CacheKeyBuilder.getTrendingTagsPrefix()}:*`,
      ]);

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
}
