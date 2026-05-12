import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { inject, injectable } from "tsyringe";
import { LikeActionCommand } from "./likeAction.command";
import { IPost, PopulatedPostUser } from "@/types/index";
import { EventBus } from "@/application/common/buses/event.bus";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { Errors } from "@/utils/errors";
import { FeedService } from "@/services/feed/feed.service";
import { Types } from "mongoose";
import { UnitOfWork } from "@/database/UnitOfWork";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { extractTagNames, buildPostPreview } from "@/utils/post-helpers";

@injectable()
export class LikeActionCommandHandler implements ICommandHandler<
  LikeActionCommand,
  IPost
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.PostLike)
    private readonly postLikeRepository: PostLikeRepository,
    @inject(TOKENS.Repositories.UserAction)
    private readonly userActionRepository: UserActionRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Feed) private readonly feedService: FeedService,
  ) {}

  /**
   * Handles the execution of the LikeActionCommand.
   * Determines whether the action is a like or an unlike and processes it accordingly.
   * @param command - The command containing the user ID and image ID.
   * @returns The updated image object.
   */
  async execute(command: LikeActionCommand): Promise<IPost> {
    let isLikeAction = true;

    const existingPost = await this.postReadRepository.findById(command.postId);
    if (!existingPost) {
      throw Errors.notFound("Post");
    }

    const postTags = extractTagNames(existingPost.tags);

    // Execute the like/unlike operation within transaction
    await this.unitOfWork.executeInTransaction(async () => {
      const existingLike = await this.postLikeRepository.hasUserLiked(
        command.postId,
        command.userId,
      );

      if (existingLike) {
        await this.handleUnlike(command);
        isLikeAction = false;
      } else {
        await this.handleLike(command, existingPost);
      }

      await this.eventBus.queueTransactional(
        new UserInteractedWithPostEvent(
          command.userId,
          isLikeAction ? "like" : "unlike",
          existingPost.publicId ?? command.postId,
          postTags,
          this.resolveOwnerPublicId(existingPost),
        ),
      );
    });

    // Return the updated image with the modified like count
    const updatedPost = await this.postReadRepository.findById(
      command.postId,
    );
    if (!updatedPost) {
      throw Errors.notFound("Post");
    }

    // Update per-post meta cache asynchronously as not to block response
    if (updatedPost.publicId) {
      this.feedService
        .updatePostLikeMeta(updatedPost.publicId, updatedPost.likesCount ?? 0)
        .catch((e) => logger.warn("updatePostLikeMeta failed", e));
    }
    return updatedPost;
  }

  /**
   * Handles the like action by creating a like record, incrementing the like count,
   * logging the user action, and triggering a notification.
   */
  private async handleLike(command: LikeActionCommand, post: IPost) {
    const added = await this.postLikeRepository.addLike(
      command.postId,
      command.userId,
    );
    if (!added) {
      throw Errors.validation("like already exists for user and post");
    }

    await this.postWriteRepository.updateLikeCount(command.postId, 1);

    await this.userActionRepository.logAction(
      command.userId,
      "like",
      command.postId,
    );

    const postOwnerPublicId = await this.resolveOwnerPublicIdAsync(post);

    if (postOwnerPublicId && postOwnerPublicId !== command.userId) {
      const actorUser = await this.userReadRepository.findById(command.userId);

      await this.eventBus.queueTransactional(
        new NotificationRequestedEvent({
          receiverId: postOwnerPublicId,
          actionType: "like",
          actorId: command.userId,
          actorUsername: actorUser?.username,
          actorHandle: actorUser?.handle,
          actorAvatar: actorUser?.avatar,
          targetId: post.publicId ?? command.postId,
          targetType: "post",
          targetPreview: buildPostPreview(post),
        }),
      );
    }
  }

  /**
   * Handles the unlike action by removing the like record, decrementing the like count,
   * and logging the user action.
   */
  private async handleUnlike(command: LikeActionCommand) {
    const removed = await this.postLikeRepository.removeLike(
      command.postId,
      command.userId,
    );
    if (!removed) {
      throw Errors.notFound("Resource");
    }

    await this.postWriteRepository.updateLikeCount(command.postId, -1);

    await this.userActionRepository.logAction(
      command.userId,
      "unlike",
      command.postId,
    );
  }

  /** Sync extraction of owner publicId from a populated post — returns empty string if not populated */
  private resolveOwnerPublicId(post: IPost): string {
    const owner = post.user as Types.ObjectId | PopulatedPostUser;
    return typeof owner === "object" && "publicId" in owner
      ? ((owner as PopulatedPostUser).publicId ?? "")
      : (owner?.toString() ?? "");
  }

  /** Async resolution — falls back to DB lookup when not populated */
  private async resolveOwnerPublicIdAsync(post: IPost): Promise<string> {
    const owner = post.user as Types.ObjectId | PopulatedPostUser;
    if (typeof owner === "object" && "publicId" in owner) {
      return (owner as PopulatedPostUser).publicId ?? "";
    }
    if (owner) {
      const ownerUser = await this.userReadRepository.findById(owner.toString());
      return ownerUser?.publicId ?? "";
    }
    return "";
  }
}
