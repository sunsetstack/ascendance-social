import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UnitOfWork } from "@/database/UnitOfWork";
import { CommentRepository } from "@/repositories/comment.repository";
import { CommentLikeRepository } from "@/repositories/commentLike.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { EventBus } from "@/application/common/buses/event.bus";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { Errors } from "@/utils/errors";
import { CommentLikeResult, IComment } from "@/types";
import { LikeCommentCommand } from "./likeComment.command";
import { TOKENS } from "@/types/tokens";

@injectable()
export class LikeCommentCommandHandler implements ICommandHandler<
  LikeCommentCommand,
  CommentLikeResult
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.CommentLike)
    private readonly commentLikeRepository: CommentLikeRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserAction)
    private readonly userActionRepository: UserActionRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: LikeCommentCommand): Promise<CommentLikeResult> {
    let isLiked = true;
    let commentOwnerPublicId = "";
    let notifyPayload: {
      receiverId: string;
      actionType: string;
      actorId: string;
      actorUsername?: string;
      actorHandle?: string;
      actorAvatar?: string;
      targetId?: string;
      targetType?: string;
      targetPreview?: string;
    } | null = null;

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

    commentOwnerPublicId = await this.resolveCommentOwnerPublicId(comment);

    await this.unitOfWork.executeInTransaction(async () => {
      const userInternalId = user._id?.toString() || user.id?.toString();
      if (!userInternalId) {
        throw Errors.validation("User internal id missing");
      }

      const alreadyLiked = await this.commentLikeRepository.hasUserLiked(
        command.commentId,
        userInternalId,
      );

      if (alreadyLiked) {
        await this.handleUnlike(command, userInternalId);
        isLiked = false;
        return;
      }

      await this.handleLike(command, userInternalId, comment);

      if (
        commentOwnerPublicId &&
        commentOwnerPublicId !== command.userPublicId
      ) {
        notifyPayload = {
          receiverId: commentOwnerPublicId,
          actionType: "comment_like",
          actorId: command.userPublicId,
          actorUsername: user.username,
          actorHandle: user.handle,
          actorAvatar: user.avatar,
          targetId: command.commentId,
          targetType: "comment",
          targetPreview: this.buildPreview(comment),
        };
      }
      if (notifyPayload) {
        await this.eventBus.queueTransactional(
          new NotificationRequestedEvent(notifyPayload),
        );
      }
    });

    const updatedComment = await this.commentRepository.findById(
      command.commentId,
    );
    if (!updatedComment) {
      throw Errors.notFound("Comment");
    }

    return {
      commentId: command.commentId,
      isLiked,
      likesCount: updatedComment.likesCount ?? 0,
    };
  }

  private async handleLike(
    command: LikeCommentCommand,
    userInternalId: string,
    comment: IComment,
  ): Promise<void> {
    const added = await this.commentLikeRepository.addLike(
      command.commentId,
      userInternalId,
    );
    if (!added) {
      throw Errors.validation("like already exists for user and comment");
    }

    await this.commentRepository.updateLikesCount(command.commentId, 1);
    await this.userActionRepository.logAction(
      userInternalId,
      "comment_like",
      command.commentId,
    );
  }

  private async handleUnlike(
    command: LikeCommentCommand,
    userInternalId: string,
  ): Promise<void> {
    const removed = await this.commentLikeRepository.removeLike(
      command.commentId,
      userInternalId,
    );
    if (!removed) {
      throw Errors.notFound("Resource");
    }

    await this.commentRepository.updateLikesCount(command.commentId, -1);
    await this.userActionRepository.logAction(
      userInternalId,
      "comment_unlike",
      command.commentId,
    );
  }

  private async resolveCommentOwnerPublicId(
    comment: IComment,
  ): Promise<string> {
    const ownerId = comment.userId?.toString();
    if (!ownerId) return "";

    const owner = await this.userReadRepository.findById(ownerId);
    return owner?.publicId ?? "";
  }

  private buildPreview(comment: IComment): string {
    const raw = comment.content;
    if (typeof raw !== "string") return "";
    if (raw.length <= 50) return raw;
    return `${raw.slice(0, 50)}...`;
  }
}
