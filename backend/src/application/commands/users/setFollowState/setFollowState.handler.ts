import { UserPublicId, asMongoId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import { SetFollowStateCommand } from "./setFollowState.command";
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

export interface SetFollowStateResult {
  action: "followed" | "unfollowed";
}

@injectable()
export class SetFollowStateCommandHandler implements ICommandHandler<
  SetFollowStateCommand,
  SetFollowStateResult
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

  async execute(command: SetFollowStateCommand): Promise<SetFollowStateResult> {
    const { followerPublicId, followeePublicId, shouldFollow } = command;
    const action = shouldFollow ? "followed" : "unfollowed";

    const [follower, followee] = await Promise.all([
      this.userReadRepository.findByPublicId(followerPublicId),
      this.userReadRepository.findByPublicId(followeePublicId),
    ]);

    if (!follower || !followee) {
      throw Errors.notFound("User");
    }
    if (shouldFollow && followee.isBanned) {
      throw Errors.notFound("User");
    }

    const followerId = asMongoId(follower._id.toString());
    const followeeId = asMongoId(followee._id.toString());

    if (followerId === followeeId) {
      throw Errors.validation("Cannot follow yourself");
    }

    const wasFollowing = await this.followRepository.isFollowing(
      followerId,
      followeeId,
    );
    if (wasFollowing === shouldFollow) {
      return { action };
    }

    try {
      await this.unitOfWork.executeInTransaction(async () => {
        if (shouldFollow) {
          await this.followRepository.addFollow(followerId, followeeId);
          await this.userWriteRepository.updateFollowingCount(followerId, 1);
          await this.userWriteRepository.updateFollowerCount(followeeId, 1);

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
          return;
        }

        if (!shouldFollow) {
          await this.followRepository.removeFollow(followerId, followeeId);
          await this.userWriteRepository.updateFollowingCount(followerId, -1);
          await this.userWriteRepository.updateFollowerCount(followeeId, -1);

          await this.userActionRepository.logAction(
            followerId,
            "unfollow",
            followeeId,
          );
        }
      });

      // invalidate feed caches after transaction commits
      await this.invalidateFeedCaches(follower.publicId);
    } catch (error) {
      if (this.isConcurrentNoOp(error, shouldFollow)) {
        return { action };
      }

      if (error instanceof AppError) throw error;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw Errors.database(errorMessage, {
        context: {
          function: "setFollowState",
          additionalInfo: "Transaction failed",
        },
        cause: error,
      });
    }

    return { action };
  }

  private async invalidateFeedCaches(
    followerPublicId: UserPublicId,
  ): Promise<void> {
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

  private isConcurrentNoOp(error: unknown, shouldFollow: boolean): boolean {
    return (
      error instanceof AppError &&
      ((shouldFollow && error.name === "DuplicateError") ||
        (!shouldFollow && error.name === "NotFoundError"))
    );
  }
}
