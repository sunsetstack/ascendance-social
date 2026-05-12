import { inject, injectable } from "tsyringe";
import { PostRepository } from "@/repositories/post.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { RedisService } from "../redis.service";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

@injectable()
export class FeedInteractionService {
  constructor(
    @inject(TOKENS.Repositories.Post) private postRepository: PostRepository,
    @inject(TOKENS.Repositories.User) private userRepository: UserRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Repositories.UserAction)
    private userActionRepository: UserActionRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
  ) {}

  public async recordInteraction(
    userPublicId: string,
    actionType: string,
    targetIdentifier: string,
    tags: string[],
  ): Promise<void> {
    logger.info(
      `Running recordInteraction... for ${userPublicId}, actionType: ${actionType}, targetId: ${targetIdentifier}, tags: ${tags}`,
    );

    const user = await this.userRepository.findByPublicId(userPublicId);
    if (!user) throw Errors.notFound("User not found");

    let internalTargetId = targetIdentifier;
    if (
      actionType === "like" ||
      actionType === "unlike" ||
      actionType === "comment" ||
      actionType === "comment_deleted"
    ) {
      const sanitized = targetIdentifier.replace(/\.[a-z0-9]{2,5}$/i, "");
      const post = await this.postRepository.findByPublicId(sanitized);
      if (post) internalTargetId = String(post._id);
    }

    await this.userActionRepository.logAction(
      String(user._id),
      actionType,
      internalTargetId,
    );

    let scoreIncrement = 0;
    if (actionType === "like" || actionType === "unlike") {
      scoreIncrement = this.getScoreIncrementForAction(actionType);
    }

    if (scoreIncrement !== 0) {
      await Promise.all(
        tags.map((tag) =>
          this.userPreferenceRepository.incrementTagScore(
            String(user._id),
            tag,
            scoreIncrement,
          ),
        ),
      );
    }

    await this.redisService.invalidateFeed(userPublicId, "for_you");

    const invalidationTags = [CacheKeyBuilder.getUserFeedTag(userPublicId)];
    await this.redisService.invalidateByTags(invalidationTags);

    await this.redisService.publish(
      "feed_updates",
      JSON.stringify({
        type: "interaction",
        userId: userPublicId,
        actionType,
        targetId: targetIdentifier,
        tags,
        timestamp: new Date().toISOString(),
      }),
    );

    logger.info("Feed invalidation completed for user interaction");
  }

  private getScoreIncrementForAction(actionType: "like" | "unlike"): number {
    const scoreMap: Record<"like" | "unlike", number> = {
      like: 2,
      unlike: -2,
    };
    return scoreMap[actionType] ?? 0;
  }
}
