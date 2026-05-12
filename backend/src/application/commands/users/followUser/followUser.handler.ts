import { inject, injectable } from "tsyringe";
import { FollowUserCommand } from "./followUser.command";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UnitOfWork } from "@/database/UnitOfWork";
import { FollowRepository } from "@/repositories/follow.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { RedisService } from "@/services/redis.service";
import { Errors, AppError } from "@/utils/errors";
import { EventBus } from "@/application/common/buses/event.bus";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export interface FollowUserResult {
  action: "followed" | "unfollowed";
}

@injectable()
export class FollowUserCommandHandler implements ICommandHandler<
  FollowUserCommand,
  FollowUserResult
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.UserAction)
    private readonly userActionRepository: UserActionRepository,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: FollowUserCommand): Promise<FollowUserResult> {
    const { followerPublicId, followeePublicId } = command;

    const [follower, followee] = await Promise.all([
      this.userReadRepository.findByPublicId(followerPublicId),
      this.userReadRepository.findByPublicId(followeePublicId),
    ]);

    if (!follower || !followee) {
      throw Errors.notFound("User");
    }

    if (follower.id === followee.id) {
      throw Errors.validation("Cannot follow yourself");
    }

    const wasFollowing = await this.followRepository.isFollowing(
      follower.id,
      followee.id,
    );

    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const followerId = follower.id;
        const followeeId = followee.id;

        if (wasFollowing) {
          // unfollow logic
          await this.followRepository.removeFollow(
            followerId,
            followeeId,
          );
          await this.userWriteRepository.update(
            followerId,
            { $pull: { following: followeeId } },
          );
          await this.userWriteRepository.update(
            followeeId,
            { $pull: { followers: followerId } },
          );
          // decrement denormalized counts
          await this.userWriteRepository.updateFollowingCount(
            followerId,
            -1,
          );
          await this.userWriteRepository.updateFollowerCount(
            followeeId,
            -1,
          );

          await this.userActionRepository.logAction(
            followerId,
            "unfollow",
            followeeId,
          );
        } else {
          // follow logic
          await this.followRepository.addFollow(
            followerId,
            followeeId,
          );
          await this.userWriteRepository.update(
            followerId,
            { $addToSet: { following: followeeId } },
          );
          await this.userWriteRepository.update(
            followeeId,
            { $addToSet: { followers: followerId } },
          );
          // increment denormalized counts
          await this.userWriteRepository.updateFollowingCount(
            followerId,
            1,
          );
          await this.userWriteRepository.updateFollowerCount(
            followeeId,
            1,
          );

          await this.userActionRepository.logAction(
            followerId,
            "follow",
            followeeId,
          );

          await this.eventBus.queueTransactional(
            new NotificationRequestedEvent({
              receiverId: followee.publicId,
              actionType: "follow",
              actorId: follower.publicId,
              actorUsername: follower.username,
              actorHandle: follower.handle,
              actorAvatar: follower.avatar,
            }),
          );
        }
      });

      // invalidate feed caches after transaction commits
      await this.invalidateFeedCaches(follower.publicId);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw Errors.database(errorMessage, {
        context: {
          function: "followUser",
          additionalInfo: "Transaction failed",
        },
        cause: error,
      });
    }

    return { action: wasFollowing ? "unfollowed" : "followed" };
  }

  private async invalidateFeedCaches(followerPublicId: string): Promise<void> {
    try {
      await this.redisService.invalidateByTags([
        CacheKeyBuilder.getUserFeedTag(followerPublicId),
        CacheKeyBuilder.getUserForYouFeedTag(followerPublicId),
        "who_to_follow",
        `user_suggestions:${followerPublicId}`,
      ]);
    } catch (error) {
      logger.warn("failed to invalidate feed caches", {
        followerPublicId,
        error,
      });
    }
  }
}
