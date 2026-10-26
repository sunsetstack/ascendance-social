import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { inject, injectable } from "tsyringe";
import { CreateCommentCommand } from "./createComment.command";
import { EventBus } from "@/application/common/buses/event.bus";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import { CommentRepository } from "@/repositories/comment.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { Errors } from "@/utils/errors";
import { AttachmentTransactionService } from "@/services/image/attachment-transaction.service";
import { sanitizeForMongo, isValidPublicId, sanitize, sanitizedTextLength } from "@/utils/sanitizers";
import { IComment, TransformedComment, PopulatedPostUser } from "@/types";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";
import { extractTagNames, buildPostPreview } from "@/utils/post-helpers";
import { asMongoId, asUserPublicId, asPostPublicId } from "@/types/branded";

@injectable()
export class CreateCommentCommandHandler implements ICommandHandler<
  CreateCommentCommand,
  TransformedComment
> {
  constructor(
    @inject(TOKENS.Services.AttachmentTransaction)
    private readonly attachments: AttachmentTransactionService,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  /**
   * Handles the execution of the CreateCommentCommand.
   * Creates a comment, updates counts, sends notifications, and publishes events.
   * @param command - The command containing user ID, image publicId, and content.
   * @returns The created comment object.
   */
  async execute(command: CreateCommentCommand): Promise<TransformedComment> {
    // Validate input straight away
    if (typeof command.content !== "string") {
      throw Errors.validation("Comment content must be a string");
    }

    if (!isValidPublicId(command.postPublicId)) {
      throw Errors.validation("Invalid postPublicId format");
    }

    const trimmed = command.content.trim();
    if (!trimmed && !command.imageBuffer) {
      throw Errors.validation("Comment content cannot be empty");
    }

    const safeContent = sanitize(trimmed);

    if (!safeContent && !command.imageBuffer) {
      throw Errors.validation("Comment content empty after sanitization");
    }

    if (sanitizedTextLength(safeContent) > 500) {
      throw Errors.validation("Comment cannot exceed 500 characters");
    }

    let createdComment!: IComment;
    let postTags: string[] = [];
    let postOwnerId: string;
    let parentComment: IComment | null = null;
    let depth = 0;

    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const post = await this.postReadRepository.findByPublicId(
      command.postPublicId,
    );
    if (!post) {
      throw Errors.notFound("Post");
    }

    if (command.parentId) {
      parentComment = await this.commentRepository.findById(
        asMongoId(command.parentId),
      );
      if (!parentComment) {
        throw Errors.notFound("Comment");
      }

      if (
        parentComment.postId.toString() !==
        (post._id as mongoose.Types.ObjectId).toString()
      ) {
        throw Errors.validation(
          "Parent comment does not belong to the same post",
        );
      }

      const parentDepth = parentComment.depth ?? 0;
      depth = parentDepth + 1;
    }

    postTags = extractTagNames(post.tags);
    const postOwner = post.user as mongoose.Types.ObjectId | PopulatedPostUser;
    postOwnerId =
      typeof postOwner === "object" && "publicId" in postOwner
        ? ((postOwner as PopulatedPostUser).publicId ?? "")
        : (postOwner?.toString() ?? "");
    const sanitizedPostId = post.publicId;

    await this.attachments.run(command, user, async (image) => {
      const payload: Partial<IComment> = {
        content: safeContent,
        image,
        postId: post._id as mongoose.Types.ObjectId,
        userId: user._id as mongoose.Types.ObjectId,
        parentId: command.parentId
          ? new mongoose.Types.ObjectId(command.parentId)
          : null,
        replyCount: 0,
        depth,
      };

      const safePayload = sanitizeForMongo(payload);

      createdComment = await this.commentRepository.create(
        safePayload as Partial<IComment>,
      );

      // Increment comment count on post
      await this.postWriteRepository.updateCommentCount(
        asMongoId((post._id as mongoose.Types.ObjectId).toString()),
        1,
      );

      if (command.parentId) {
        await this.commentRepository.updateReplyCount(
          asMongoId(command.parentId),
          1,
        );
      }

      // Send notification to post owner (if not commenting on own post)
      if (postOwnerId && postOwnerId !== command.userPublicId) {
        const postPreview = buildPostPreview(post);

        await this.eventBus.queueTransactional(
          new NotificationRequestedEvent({
            receiverId: asUserPublicId(postOwnerId),
            actionType: "comment",
            actorId: asUserPublicId(command.userPublicId),
            actorUsername: user.username,
            actorHandle: user.handle,
            actorAvatar: user.avatar,
            targetId: asPostPublicId(command.postPublicId),
            targetType: "post",
            targetPreview: postPreview,
          }),
        );
      }

      // Send notification to parent comment owner (for replies), but avoid double notifying post owner
      if (command.parentId && parentComment) {
        const parentOwnerId = parentComment.userId?.toString();
        if (parentOwnerId) {
          const parentOwner = await this.userReadRepository.findById(
            asMongoId(parentOwnerId),
          );
          const parentOwnerPublicId = parentOwner?.publicId;
          if (
            parentOwnerPublicId &&
            parentOwnerPublicId !== command.userPublicId &&
            parentOwnerPublicId !== postOwnerId
          ) {
            await this.eventBus.queueTransactional(
              new NotificationRequestedEvent({
                receiverId: asUserPublicId(parentOwnerPublicId),
                actionType: "comment_reply",
                actorId: asUserPublicId(command.userPublicId),
                actorUsername: user.username,
                actorHandle: user.handle,
                actorAvatar: user.avatar,
                targetId: asPostPublicId(command.postPublicId),
                targetType: "comment",
                targetPreview:
                  safeContent.substring(0, 50) +
                  (safeContent.length > 50 ? "..." : ""),
              }),
            );
          }
        }
      }

      // Handle mentions
      const mentionRegex = /@([a-zA-Z0-9._]+)/g;
      const mentions = [...safeContent.matchAll(mentionRegex)].map(
        (match) => match[1],
      );

      if (mentions.length > 0) {
        const uniqueMentions = [...new Set(mentions)];
        const mentionedUsers =
          await this.userReadRepository.findUsersByHandles(uniqueMentions);

        for (const mentionedUser of mentionedUsers) {
          // Filter: Remove comment author
          if (mentionedUser.publicId === command.userPublicId) {
            continue;
          }

          // Filter: Remove post owner since I already notified them above
          if (mentionedUser.publicId === postOwnerId) {
            continue;
          }

          await this.eventBus.queueTransactional(
            new NotificationRequestedEvent({
              receiverId: asUserPublicId(mentionedUser.publicId),
              actionType: "mention",
              actorId: asUserPublicId(command.userPublicId),
              actorUsername: user.username,
              actorHandle: user.handle,
              actorAvatar: user.avatar,
              targetId: asPostPublicId(command.postPublicId),
              targetType: "post",
              targetPreview:
                safeContent.substring(0, 50) +
                (safeContent.length > 50 ? "..." : ""),
            }),
          );
        }
      }

      await this.eventBus.queueTransactional(
        new UserInteractedWithPostEvent(
          asUserPublicId(command.userPublicId),
          "comment",
          asPostPublicId(sanitizedPostId),
          postTags,
          asUserPublicId(postOwnerId),
        ),
      );
    });

    if (!createdComment) {
      throw Errors.internal("Comment was not created");
    }
    const populatedComment = await this.commentRepository.findByIdTransformed(
      (createdComment._id as mongoose.Types.ObjectId).toString(),
    );
    if (!populatedComment) {
      throw Errors.internal("Failed to retrieve created comment");
    }

    return populatedComment;
  }
}
