import mongoose from "mongoose";
import { inject, injectable } from "tsyringe";
import { EventBus } from "@/application/common/buses/event.bus";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { UnitOfWork } from "@/database/UnitOfWork";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";
import { IUser } from "@/types";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { Errors, createError } from "@/utils/errors";
import { isValidPublicId } from "@/utils/sanitizers";
import { UnrepostPostCommand } from "./unrepostPost.command";

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
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.ContentCleanup)
    private readonly contentCleanupService: ContentCleanupService,
    @inject(TOKENS.CQRS.Handlers.EventBus)
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: UnrepostPostCommand): Promise<UnrepostResult> {
    if (!isValidPublicId(command.userPublicId)) {
      throw Errors.validation("Invalid userPublicId format");
    }
    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw createError(
        "NotFoundError",
        `User with publicId ${command.userPublicId} not found`,
      );
    }
    const targetPost = await this.postReadRepository.findByPublicId(
      command.targetPostPublicId,
    );
    if (!targetPost) {
      throw createError(
        "NotFoundError",
        `Post ${command.targetPostPublicId} not found`,
      );
    }
    const repost = await this.postReadRepository.findOneByFilter({
      user: (user as IUser)._id as mongoose.Types.ObjectId,
      repostOf: targetPost._id,
      type: "repost",
    });
    if (!repost) {
      throw createError("NotFoundError", "You have not reposted this post");
    }

    await this.unitOfWork.executeInTransaction(async () => {
      const cleanup = await this.contentCleanupService.deletePostGraph([
        new mongoose.Types.ObjectId(repost._id!.toString()),
      ]);
      for (const deletedPost of cleanup.posts) {
        await this.eventBus.queueTransactional(
          new PostDeletedEvent(
            asPostPublicId(deletedPost.publicId),
            asUserPublicId(
              deletedPost.authorPublicId || command.userPublicId,
            ),
          ),
        );
      }
    });

    return { message: "Repost removed successfully" };
  }
}
