import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { inject, injectable } from "tsyringe";
import { DeleteCommentCommand } from "./deleteComment.command";
import { EventBus } from "@/application/common/buses/event.bus";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import { CommentRepository } from "@/repositories/comment.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { Errors } from "@/utils/errors";
import { UnitOfWork } from "@/database/UnitOfWork";
import { logger } from "@/utils/winston";
import { extractTagNames, extractPostOwnerInfo } from "@/utils/post-helpers";
import { TOKENS } from "@/types/tokens";

@injectable()
export class DeleteCommentCommandHandler implements ICommandHandler<
  DeleteCommentCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) { }

  /**
   * Handles the execution of the DeleteCommentCommand.
   * If the comment has replies, it performs a soft delete (marks as deleted, clears user info).
   * If the comment has no replies, it performs a hard delete (removes from database).
   * @param command - The command containing comment ID and user ID.
   */
  async execute(command: DeleteCommentCommand): Promise<void> {
    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const comment = await this.commentRepository.findById(command.commentId);
    if (!comment) {
      throw Errors.notFound("Comment");
    }

    if (comment.isDeleted) {
      throw Errors.validation("Comment has already been deleted");
    }

    const post = await this.postReadRepository.findByIdWithPopulates(
      comment.postId.toString(),
    );
    if (!post) {
      throw Errors.notFound("Post");
    }

    // Check if user owns the comment or the post
    const isCommentOwner = comment.userId?.toString() === user.id;
    const { ownerInternalId: postOwnerInternalId, ownerPublicId: postOwnerPublicId } =
      extractPostOwnerInfo(post);
    const isPostOwner = postOwnerInternalId === user.id;

    if (!isCommentOwner && !isPostOwner && !user.isAdmin) {
      throw Errors.forbidden(
        "You can only delete your own comments or comments on your posts",
      );
    }

    // Determine who initiated the delete for audit purposes
    const deletedBy: "user" | "post_owner" | "admin" = isCommentOwner
      ? "user"
      : user.isAdmin
        ? "admin"
        : "post_owner";

    // Extract post data for events
    const postTags = extractTagNames(post.tags);
    let postOwnerId = postOwnerPublicId ?? "";
    if (!postOwnerId && postOwnerInternalId) {
      const ownerDoc =
        await this.userReadRepository.findById(postOwnerInternalId);
      postOwnerId = ownerDoc?.publicId ?? "";
    }
    const postPublicId = post.publicId ?? comment.postId.toString();

    // Check if the comment has any replies
    const hasReplies = await this.commentRepository.hasReplies(
      command.commentId,
    );

    await this.unitOfWork.executeInTransaction(async () => {
      if (hasReplies) {
        // Soft delete: keep the comment but mark as deleted and clear user association
        await this.commentRepository.softDeleteComment(
          command.commentId,
          deletedBy === "user" ? "user" : "admin",
        );
        logger.info(
          `Comment ${command.commentId} soft-deleted (has replies) by ${deletedBy}`,
        );
      } else {
        // Hard delete: no replies, safe to remove entirely
        await this.commentRepository.deleteComment(command.commentId);

        // Decrement comment count on post only for hard deletes
        await this.postWriteRepository.updateCommentCount(
          comment.postId.toString(),
          -1,
        );

        // If this comment had a parent, decrement the parent's reply count
        if (comment.parentId) {
          await this.commentRepository.updateReplyCount(
            comment.parentId.toString(),
            -1,
          );
        }

        logger.info(
          `Comment ${command.commentId} hard-deleted (no replies) by ${deletedBy}`,
        );
      }

      // Queue event for feed interaction handling and real-time updates
      await this.eventBus.queueTransactional(
        new UserInteractedWithPostEvent(
          command.userPublicId,
          "comment_deleted",
          postPublicId,
          postTags,
          postOwnerId,
        ),
      );
    });

    logger.info(
      `Comment ${command.commentId} successfully deleted by user ${command.userPublicId}`,
    );
  }
}
