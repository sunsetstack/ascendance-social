import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { inject, injectable } from "tsyringe";
import { LikeActionByPublicIdCommand } from "./likeActionByPublicId.command";
import {
  IPost,
  PostDTO,
  PopulatedPostUser,
} from "@/types/index";
import { EventBus } from "@/application/common/buses/event.bus";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { DTOService } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { Types } from "mongoose";
import { UnitOfWork } from "@/database/UnitOfWork";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { extractTagNames, buildPostPreview } from "@/utils/post-helpers";

@injectable()
export class LikeActionByPublicIdCommandHandler implements ICommandHandler<
  LikeActionByPublicIdCommand,
  PostDTO
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
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(command: LikeActionByPublicIdCommand): Promise<PostDTO> {
    let isLikeAction = true;

    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const userMongoId = user._id?.toString() ?? user.id?.toString();
    if (!userMongoId) {
      throw Errors.notFound("User");
    }

    const existingPost = await this.postReadRepository.findByPublicId(
      command.postPublicId,
    );
    if (!existingPost) {
      throw Errors.notFound("Post");
    }

    const postTags = extractTagNames(existingPost.tags);

    const postInternalId =
      existingPost._id?.toString() ?? existingPost.id?.toString() ?? null;
    if (!postInternalId) {
      throw Errors.notFound("Post");
    }

    const postOwnerPublicId = await this.resolveOwnerPublicIdAsync(existingPost);

    await this.unitOfWork.executeInTransaction(async () => {
      const existingLike = await this.postLikeRepository.hasUserLiked(
        postInternalId,
        userMongoId,
      );

      if (existingLike) {
        await this.handleUnlike(userMongoId, postInternalId);
        isLikeAction = false;
      } else {
        await this.handleLike(
          command,
          userMongoId,
          existingPost,
          postOwnerPublicId,
        );
      }
      await this.eventBus.queueTransactional(
        new UserInteractedWithPostEvent(
          command.userPublicId,
          isLikeAction ? "like" : "unlike",
          existingPost.publicId,
          postTags,
          postOwnerPublicId,
        ),
      );
    });

    const updatedPost = await this.postReadRepository.findByPublicId(
      command.postPublicId,
    );
    if (!updatedPost) {
      throw Errors.notFound("Post");
    }

    return this.dtoService.toPostDTO(updatedPost);
  }

  private async handleLike(
    command: LikeActionByPublicIdCommand,
    userMongoId: string,
    post: IPost,
    postOwnerPublicId: string,
  ) {
    const postId = post._id?.toString();
    const added = await this.postLikeRepository.addLike(postId, userMongoId);
    if (!added) {
      throw Errors.validation("like already exists for user and post");
    }

    await this.postWriteRepository.updateLikeCount(postId, 1);

    await this.userActionRepository.logAction(
      userMongoId,
      "like",
      post._id?.toString(),
    );

    if (postOwnerPublicId && postOwnerPublicId !== command.userPublicId) {
      const actorUser = await this.userReadRepository.findById(userMongoId);

      await this.eventBus.queueTransactional(
        new NotificationRequestedEvent({
          receiverId: postOwnerPublicId,
          actionType: "like",
          actorId: command.userPublicId,
          actorUsername: actorUser?.username ?? "Unknown",
          actorHandle: actorUser?.handle,
          actorAvatar: actorUser?.avatar,
          targetId: post.publicId,
          targetType: "post",
          targetPreview: buildPostPreview(post),
        }),
      );
    }
  }

  private async handleUnlike(
    userMongoId: string,
    postId: string,
  ) {
    const removed = await this.postLikeRepository.removeLike(
      postId,
      userMongoId,
    );
    if (!removed) {
      throw Errors.notFound("Resource");
    }
    await this.userActionRepository.logAction(userMongoId, "unlike", postId);
    await this.postWriteRepository.updateLikeCount(postId, -1);
  }

  /** Async resolution of post owner publicId — falls back to DB lookup when not populated */
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
