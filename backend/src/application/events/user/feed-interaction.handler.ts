import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import { FeedInteractionService } from "@/services/feed/feed-interaction.service";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { RedisService } from "@/services/redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { buildRealtimeEventId } from "@/application/common/events/event-registry";
@injectable()
export class FeedInteractionHandler implements IEventHandler<UserInteractedWithPostEvent> {
  constructor(
    @inject(TOKENS.Services.FeedInteraction)
    private readonly feedInteractionService: FeedInteractionService,
    @inject(TOKENS.Services.FeedMeta)
    private readonly feedMetaService: FeedMetaService,
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postRepository: IPostReadRepository,
  ) {}

  async handle(event: UserInteractedWithPostEvent): Promise<void> {
    try {
      const [actor, post] = await Promise.all([
        this.userRepository.findByPublicId(event.userId),
        this.postRepository.findByPublicId(event.postId),
      ]);
      if (!actor || actor.isBanned || !post) {
        logger.info("Skipping interaction from an unavailable account or post", {
          userPublicId: event.userId,
          postPublicId: event.postId,
        });
        return;
      }

      const timestamp = new Date(event.timestamp);
      const eventId =
        event.eventId ??
        buildRealtimeEventId(
          event.type,
          event.userId,
          event.postId,
          event.interactionType,
          timestamp.toISOString(),
        );
      await this.feedInteractionService.recordInteraction(
        event.userId,
        event.interactionType,
        event.postId,
        event.tags,
        { eventId, timestamp, activityId: event.activityId },
      );

      await this.redis.pushToStream("stream:interactions", {
        postId: event.postId,
        userId: event.userId,
        type: event.interactionType,
        eventId,
        timestamp: timestamp.getTime().toString(),
        tags: event.tags ? JSON.stringify(event.tags) : undefined,
      });
      if (
        (event.interactionType === "like" || event.interactionType === "unlike") &&
        post.publicId
      ) {
        await this.feedMetaService.updatePostLikeMeta(
          post.publicId,
          post.likesCount || 0,
          eventId,
        );
      }
    } catch (error) {
      logger.error("Feed update failed", { error });
      throw error;
    }
  }
}
