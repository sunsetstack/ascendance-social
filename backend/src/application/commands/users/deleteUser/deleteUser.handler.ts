import { inject, injectable } from "tsyringe";
import { Model, Types } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { DeleteUserCommand } from "./deleteUser.command";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { ImageRepository } from "@/repositories/image.repository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import { CommentRepository } from "@/repositories/comment.repository";
import { FollowRepository } from "@/repositories/follow.repository";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { NotificationRepository } from "@/repositories/notification.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { PostViewRepository } from "@/repositories/postView.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type { IImageStorageService, IUser } from "@/types";
import { UnitOfWork, sessionALS } from "@/database/UnitOfWork";
import { Errors, wrapError } from "@/utils/errors";
import { EventBus } from "@/application/common/buses/event.bus";
import { UserDeletedEvent } from "@/application/events/user/user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

@injectable()
export class DeleteUserCommandHandler implements ICommandHandler<
  DeleteUserCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.Image)
    private readonly imageRepository: ImageRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.PostLike)
    private readonly postLikeRepository: PostLikeRepository,
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.Repositories.Favorite)
    private readonly favoriteRepository: FavoriteRepository,
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Repositories.UserAction)
    private readonly userActionRepository: UserActionRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private readonly userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.PostView)
    private readonly postViewRepository: PostViewRepository,
    @inject(TOKENS.Repositories.Community)
    private readonly communityRepository: CommunityRepository,
    @inject(TOKENS.Repositories.CommunityMember)
    private readonly communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
  ) {}

  async execute(command: DeleteUserCommand): Promise<void> {
    // verify password before proceeding with deletion (unless admin bypass)
    if (!command.skipPasswordVerification) {
      if (!command.password) {
        throw Errors.validation("Password is required for account deletion");
      }

      const userWithPassword = await this.userModel
        .findOne({ publicId: command.userPublicId })
        .select("+password")
        .exec();

      if (!userWithPassword) {
        throw Errors.notFound("User");
      }

      const isPasswordValid = await userWithPassword.comparePassword(
        command.password,
      );
      if (!isPasswordValid) {
        throw Errors.authentication("Invalid password");
      }
    }

    // capture follower public IDs before deletion for cache invalidation
    let followerPublicIds: string[] = [];
    let userPublicId: string = command.userPublicId;
    let userId: string = "";

    try {
      // get followers before transaction since findUsersFollowing doesn't support sessions
      const followers = await this.userReadRepository.findUsersFollowing(
        command.userPublicId,
      );
      followerPublicIds = followers.map((f) => f.publicId);

      await this.unitOfWork.executeInTransaction(async () => {
        const user = await this.userReadRepository.findByPublicId(
          command.userPublicId,
        );
        if (!user) {
          throw Errors.notFound("User");
        }

        userId = user.id;
        userPublicId = user.publicId;

        // get users that the deleted user was following (they need followerCount decremented)
        const followingIds =
          await this.followRepository.getFollowingObjectIds(userId);

        // get users that were following the deleted user (they need followingCount decremented)
        const followerIds =
          await this.followRepository.getFollowerObjectIds(userId);

        // delete all user relationships and content in proper order
        await this.commentRepository.deleteCommentsByUserId(userId);

        await this.postLikeRepository.removeLikesByUser(userId);

        await this.favoriteRepository.deleteManyByUserId(userId);

        await this.postViewRepository.deleteManyByUserId(userId);

        await this.postWriteRepository.deleteManyByUserId(userId);

        await this.imageRepository.deleteMany(userId);

        await this.followRepository.deleteAllFollowsByUserId(userId);

        const uniqueFollowingIds = Array.from(new Set(followingIds));
        if (uniqueFollowingIds.length > 0) {
          await this.userModel
            .updateMany(
              {
                _id: {
                  $in: uniqueFollowingIds.map((id) => new Types.ObjectId(id)),
                },
              },
              { $inc: { followerCount: -1 } },
              { session: sessionALS.getStore() ?? undefined },
            )
            .exec();
        }

        const uniqueFollowerIds = Array.from(new Set(followerIds));
        if (uniqueFollowerIds.length > 0) {
          await this.userModel
            .updateMany(
              {
                _id: {
                  $in: uniqueFollowerIds.map((id) => new Types.ObjectId(id)),
                },
              },
              { $inc: { followingCount: -1 } },
              { session: sessionALS.getStore() ?? undefined },
            )
            .exec();
        }

        await this.userPreferenceRepository.deleteManyByUserId(userId);

        await this.userActionRepository.deleteManyByUserId(userId);

        await this.notificationRepository.deleteManyByUserId(user.publicId);
        await this.notificationRepository.deleteManyByActorId(user.publicId);

        const joinedCommunityIds = (user.joinedCommunities ?? [])
          .map((community) =>
            community && community._id ? community._id.toString() : "",
          )
          .filter((id): id is string => id.length > 0);
        await this.communityRepository.decrementMemberCountsByIds(
          joinedCommunityIds,
        );
        await this.communityMemberRepository.deleteManyByUserId(userId);

        const userConversations =
          await this.conversationRepository.findByParticipant(userId);

        for (const conversation of userConversations) {
          const conversationId =
            conversation.id || conversation._id?.toString();
          if (!conversationId) continue;

          if (conversation.participants.length <= 2) {
            // delete the conversation
            await this.conversationRepository.delete(conversationId);
          } else {
            // remove user from participants array
            await this.conversationRepository.removeParticipant(
              conversationId,
              userId,
            );
          }
        }

        await this.messageRepository.deleteManyBySender(userId);

        await this.messageRepository.removeUserFromReadBy(userId);

        // finally, delete the user
        await this.userWriteRepository.delete(userId);
      });

      // delete all user-related cloud storage assets (after successful transaction commit)
      // this includes images, avatars, covers, etc.
      try {
        const cloudResult =
          await this.imageStorageService.deleteMany(userPublicId);
        if (cloudResult.result !== "ok") {
          console.warn("Failed to delete cloud assets:", cloudResult.message);
        }
      } catch (cloudError) {
        console.warn("Error during cloud assets deletion:", cloudError);
      }

      // emit event after successful deletion to trigger cache cleanup
      await this.eventBus.publish(
        new UserDeletedEvent(userPublicId, userId, followerPublicIds),
      );

      // Explicitly invalidate "Who to follow" cache (global or user-specific if tagged)
      await this.redisService.invalidateByTags([
        "who_to_follow",
        `user:${userPublicId}`,
        CacheKeyBuilder.getUserFeedTag(userPublicId),
        CacheKeyBuilder.getTrendingFeedTag(),
        CacheKeyBuilder.getNewFeedTag(),
      ]);

      // Remove user from trending sets if they are there (though trending is usually post-based)
    } catch (error) {
      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal("An unknown error occurred during user deletion");
    }
  }
}
