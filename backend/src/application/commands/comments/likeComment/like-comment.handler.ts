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
import {
  asMongoId,
  asUserPublicId,
  MongoId,
  UserPublicId,
  PostPublicId,
  ImagePublicId,
} from "@/types/branded";

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
      receiverId: UserPublicId;
      actionType: string;
      actorId: UserPublicId;
      actorUsername?: string;
      actorHandle?: string;
      actorAvatar?: string;
      targetId?: PostPublicId | ImagePublicId | UserPublicId | MongoId;
      targetType?: string;
      targetPreview?: string;
    } | null = null;

    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const comment = await this.commentRepository.findById(
      asMongoId(command.commentId),
    );
    if (!comment) {
      throw Errors.notFound("Comment");
    }

    commentOwnerPublicId = await this.resolveCommentOwnerPublicId(comment);

    await this.unitOfWork.executeInTransaction(async () => {
      const userInternalId = asMongoId(
        user._id?.toString() || user.id?.toString(),
      );
      if (!userInternalId) {
        throw Errors.validation("User internal id missing");
      }

      const alreadyLiked = await this.commentLikeRepository.hasUserLiked(
        asMongoId(command.commentId),
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
          receiverId: asUserPublicId(commentOwnerPublicId),
          actionType: "comment_like",
          actorId: asUserPublicId(command.userPublicId),
          actorUsername: user.username,
          actorHandle: user.handle,
          actorAvatar: user.avatar,
          targetId: asMongoId(command.commentId),
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
      asMongoId(command.commentId),
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
    userInternalId: MongoId,
    _comment: IComment,
  ): Promise<void> {
    const added = await this.commentLikeRepository.addLike(
      asMongoId(command.commentId),
      userInternalId,
    );
    if (!added) {
      throw Errors.validation("like already exists for user and comment");
    }

    await this.commentRepository.updateLikesCount(
      asMongoId(command.commentId),
      1,
    );
    await this.userActionRepository.logAction(
      userInternalId,
      "comment_like",
      asMongoId(command.commentId),
    );
  }

  private async handleUnlike(
    command: LikeCommentCommand,
    userInternalId: MongoId,
  ): Promise<void> {
    const removed = await this.commentLikeRepository.removeLike(
      asMongoId(command.commentId),
      userInternalId,
    );
    if (!removed) {
      throw Errors.notFound("Resource");
    }

    await this.commentRepository.updateLikesCount(
      asMongoId(command.commentId),
      -1,
    );
    await this.userActionRepository.logAction(
      userInternalId,
      "comment_unlike",
      asMongoId(command.commentId),
    );
  }

  private async resolveCommentOwnerPublicId(
    comment: IComment,
  ): Promise<string> {
    const ownerId = comment.userId?.toString();
    if (!ownerId) return "";

    const owner = await this.userReadRepository.findById(asMongoId(ownerId));
    return owner?.publicId ?? "";
  }

  private buildPreview(comment: IComment): string {
    const raw = comment.content;
    if (typeof raw !== "string") return "";
    if (raw.length <= 50) return raw;
    return `${raw.slice(0, 50)}...`;
  }
}
