import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import { FeedService } from "@/services/feed/feed.service";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
@injectable()
export class FeedInteractionHandler implements IEventHandler<UserInteractedWithPostEvent> {
  constructor(
    @inject(TOKENS.Services.Feed) private readonly feedService: FeedService,
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private readonly userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postRepository: IPostReadRepository,
  ) {}

  async handle(event: UserInteractedWithPostEvent): Promise<void> {
    try {
      await this.feedService.recordInteraction(
        event.userId,
        event.interactionType,
        event.postId,
        event.tags,
      );

      await this.redis.pushToStream("stream:interactions", {
        postId: event.postId,
        userId: event.userId,
        type: event.interactionType,
        timestamp: Date.now().toString(),
        tags: event.tags ? JSON.stringify(event.tags) : undefined,
      });
      await this.invalidateRelevantFeeds(event);

      // Publish real-time interaction event for WebSocket notifications
      await this.publishInteractionEvent(event);
    } catch (error) {
      console.error("Feed update failed:", error);
      throw error;
    }
  }

  /**
   * Invalidate feeds for users who would see this interaction change
   */
  private async invalidateRelevantFeeds(
    event: UserInteractedWithPostEvent,
  ): Promise<void> {
    logger.info(
      `Smart cache handling for interaction: ${event.interactionType} on post ${event.postId}`,
    );

    const isLikeEvent =
      event.interactionType === "like" || event.interactionType === "unlike";

    if (isLikeEvent) {
      // Update per-image meta so all users see new like count without structural invalidation
      try {
        logger.info(`event.postId in invalidateRelevantFeeds: ${event.postId}`);
        const post = await this.postRepository.findByPublicId(event.postId);
        if (post && post.publicId) {
          await this.feedService.updatePostLikeMeta(
            post.publicId,
            post.likesCount || 0,
          );
        }
      } catch (e) {
        console.warn(
          "Failed to update post like meta during like/unlike event",
          e,
        );
      }
      // Invalidate only actor's structural feed using tags
      await this.redis.invalidateByTags([
        CacheKeyBuilder.getUserFeedTag(event.userId),
        CacheKeyBuilder.getUserForYouFeedTag(event.userId),
      ]);
      logger.info(
        "Selective invalidation done (actor only) for like/unlike; others rely on meta overlay",
      );
      return;
    }

    // Non-like events: invalidate actor's feeds and affected users' feeds using tags
    const tagsToInvalidate: string[] = [
      CacheKeyBuilder.getUserFeedTag(event.userId),
      CacheKeyBuilder.getUserForYouFeedTag(event.userId),
    ];

    const affectedUsers = await this.getAffectedUsers(event);
    if (affectedUsers.length > 0) {
      affectedUsers.forEach((publicId) => {
        tagsToInvalidate.push(CacheKeyBuilder.getUserFeedTag(publicId));
        tagsToInvalidate.push(CacheKeyBuilder.getUserForYouFeedTag(publicId));
      });
      logger.info(
        `Invalidating feeds for ${affectedUsers.length} affected users (non-like event)`,
      );
    }

    await this.redis.invalidateByTags(tagsToInvalidate);
  }
  /**
   * Determine which users would see this image in their personalized feeds
   */
  private async getAffectedUsers(
    event: UserInteractedWithPostEvent,
  ): Promise<string[]> {
    const affectedUsers: string[] = [];

    try {
      // get post owner followers
      if (event.postOwnerId) {
        const followers = await this.getFollowersOfUser(event.postOwnerId);
        affectedUsers.push(...followers);
      }

      // users who are interested in these tags
      if (event.tags && event.tags.length > 0) {
        const tagInterestedUsers = await this.getUsersInterestedInTags(
          event.tags,
        );
        affectedUsers.push(...tagInterestedUsers);
      }

      // Remove duplicates and the acting user because it's already handled above
      return [...new Set(affectedUsers)].filter((id) => id !== event.userId);
    } catch (error) {
      console.error("Error determining affected users:", error);
      // Fallback: invalidate global feeds using tags (except new_feed - lazy refresh)
      await this.redis.invalidateByTags([CacheKeyBuilder.getTrendingFeedTag()]);
      return [];
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

  private async getUsersInterestedInTags(tags: string[]): Promise<string[]> {
    try {
      const interestedUsers =
        await this.userPreferenceRepository.getUsersWithTagPreferences(tags);
      return interestedUsers.map((user) => user.publicId);
    } catch (error) {
      console.error(
        `Error getting users interested in tags ${tags.join(", ")}:`,
        error,
      );
      return [];
    }
  }

  /**
   * Publish real-time interaction event to Redis for WebSocket broadcasting
   */
  private async publishInteractionEvent(
    event: UserInteractedWithPostEvent,
  ): Promise<void> {
    try {
      const interactionMessage = {
        type: "interaction" as const,
        userId: event.userId,
        actionType: event.interactionType,
        targetId: event.postId,
        tags: event.tags,
        timestamp: new Date().toISOString(),
      };

      await this.redis.publish(
        "feed_updates",
        JSON.stringify(interactionMessage),
      );
      logger.info(
        `Published real-time interaction event: ${event.interactionType} on post ${event.postId} by user ${event.userId}`,
      );
    } catch (error) {
      console.error("Failed to publish interaction event:", error);
    }
  }
}
