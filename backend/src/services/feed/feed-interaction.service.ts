import { UserPublicId, asPostPublicId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { RedisService } from "../redis.service";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";
import { createHash } from "node:crypto";
import { UnitOfWork } from "@/database/UnitOfWork";

export interface FeedInteractionIdentity {
  eventId: string;
  timestamp: Date;
  activityId?: string;
}

@injectable()
export class FeedInteractionService {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Repositories.UserAction)
    private userActionRepository: UserActionRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Repositories.UnitOfWork) private unitOfWork: UnitOfWork,
  ) {}

  public async recordInteraction(
    userPublicId: UserPublicId,
    actionType: string,
    targetIdentifier: string,
    tags: string[],
    identity: FeedInteractionIdentity,
  ): Promise<void> {
    logger.info("Recording feed interaction", {
      event: "feed.interaction.recording",
      actionType,
    });

    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) throw Errors.notFound("User not found");

    let internalTargetId = targetIdentifier;
    if (
      actionType === "like" ||
      actionType === "unlike" ||
      actionType === "comment" ||
      actionType === "comment_deleted"
    ) {
      const sanitized = targetIdentifier.replace(/\.[a-z0-9]{2,5}$/i, "");
      const post = await this.postReadRepository.findByPublicId(
        asPostPublicId(sanitized),
      );
      if (post) internalTargetId = String(post._id);
    }

    const activityId =
      identity.activityId ??
      createHash("sha256")
        .update(`feed-interaction:${identity.eventId}`)
        .digest("hex")
        .slice(0, 24);
    await this.unitOfWork.executeInTransaction(async () => {
      const claimed = await this.userActionRepository.claimFeedEffects(
        activityId,
        String(user._id),
        actionType,
        internalTargetId,
        identity.timestamp,
      );
      if (!claimed) return;

      if (actionType === "like" || actionType === "unlike") {
        for (const tag of new Set(tags)) {
          await this.userPreferenceRepository.incrementTagScore(
            String(user._id),
            tag,
            this.getScoreIncrementForAction(actionType),
          );
        }
      }
    });

    await this.redisService.invalidateFeed(userPublicId, "for_you");

    const invalidationTags = [CacheKeyBuilder.getUserFeedTag(userPublicId)];
    await this.redisService.invalidateByTags(invalidationTags);

    const timestamp = identity.timestamp.toISOString();
    await this.redisService.publish(
      EventRegistry.redisChannels.feedUpdates,
      JSON.stringify({
        eventId: buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.interaction,
          identity.eventId,
        ),
        type: EventRegistry.realtimeMessageTypes.interaction,
        userId: userPublicId,
        actionType,
        targetId: targetIdentifier,
        tags,
        timestamp,
      }),
    );

    logger.info("Feed invalidation completed for user interaction", {
      event: "feed.interaction.invalidation.completed",
      actionType,
    });
  }

  private getScoreIncrementForAction(actionType: "like" | "unlike"): number {
    const scoreMap: Record<"like" | "unlike", number> = {
      like: 2,
      unlike: -2,
    };
    return scoreMap[actionType] ?? 0;
  }
}
