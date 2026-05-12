import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UnrepostPostCommand } from "./unrepostPost.command";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IPostWriteRepository } from "@/repositories/interfaces/IPostWriteRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { CommentRepository } from "@/repositories/comment.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { Errors } from "@/utils/errors";
import { isValidPublicId } from "@/utils/sanitizers";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";

export interface UnrepostResult {
  message: string;
}

@injectable()
export class UnrepostPostCommandHandler implements ICommandHandler<
  UnrepostPostCommand,
  UnrepostResult
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: UnrepostPostCommand): Promise<UnrepostResult> {
    if (!isValidPublicId(command.userPublicId)) {
      throw Errors.validation("Invalid userPublicId format");
    }

    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const targetPost = await this.postReadRepository.findByPublicId(
      command.targetPostPublicId,
    );
    if (!targetPost) {
      throw Errors.notFound("Post");
    }

    // Find the user's repost of the target post
    const userId = (user as IUser)._id as mongoose.Types.ObjectId;
    const repost = await this.postReadRepository.findOneByFilter({
      user: userId,
      repostOf: targetPost._id,
      type: "repost",
    });

    if (!repost) {
      throw Errors.notFound("Resource");
    }

    await this.unitOfWork.executeInTransaction(async () => {
      const repostInternalId = repost._id!.toString();
      await this.postWriteRepository.delete(repostInternalId);
      await this.commentRepository.deleteCommentsByPostId(repostInternalId);
      await this.postWriteRepository.updateRepostCount(
        targetPost._id!.toString(),
        -1,
      );
    });

    // Fire event for cache invalidation after transaction commits
    await this.eventBus.publish(
      new PostDeletedEvent(repost.publicId, command.userPublicId),
    );

    return { message: "Repost removed successfully" };
  }
}
