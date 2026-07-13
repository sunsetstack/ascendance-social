import mongoose from "mongoose";
import { inject, injectable } from "tsyringe";
import { EventBus } from "@/application/common/buses/event.bus";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { UnitOfWork } from "@/database/UnitOfWork";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";
import { IPost, IUser } from "@/types";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import {
  PostAuthorizationError,
  PostNotFoundError,
  UserNotFoundError,
  mapPostError,
} from "../../../errors/post.errors";
import { DeletePostCommand } from "./deletePost.command";

export interface DeletePostResult {
  message: string;
}

@injectable()
export class DeletePostCommandHandler implements ICommandHandler<
  DeletePostCommand,
  DeletePostResult
> {
  constructor(
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.CommunityMember)
    private readonly communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Services.ContentCleanup)
    private readonly contentCleanupService: ContentCleanupService,
    @inject(TOKENS.CQRS.Handlers.EventBus)
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: DeletePostCommand): Promise<DeletePostResult> {
    let postAuthorPublicId: string | undefined;
    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const post = await this.validatePostExists(command.postPublicId);
        const requester = await this.validateUserExists(
          command.requesterPublicId,
        );
        await this.validateDeletePermission(requester, post);

        postAuthorPublicId =
          post.author?.publicId ?? command.requesterPublicId;
        const cleanup = await this.contentCleanupService.deletePostGraph([
          new mongoose.Types.ObjectId(post._id!.toString()),
        ]);

        for (const deletedPost of cleanup.posts) {
          await this.eventBus.queueTransactional(
            new PostDeletedEvent(
              asPostPublicId(deletedPost.publicId),
              asUserPublicId(
                deletedPost.authorPublicId || command.requesterPublicId,
              ),
            ),
          );
        }

        for (const asset of cleanup.imageAssets) {
          await this.eventBus.queueTransactional(
            new ImageAssetCleanupRequestedEvent(
              "post-deleted",
              asset.storagePublicId,
              asset.url,
              command.requesterPublicId,
              asUserPublicId(
                asset.ownerPublicId ||
                  postAuthorPublicId ||
                  command.requesterPublicId,
              ),
            ),
          );
        }
      });
      return { message: "Post deleted successfully" };
    } catch (error) {
      throw mapPostError(error, {
        action: "delete-post",
        postPublicId: command.postPublicId,
        requesterPublicId: command.requesterPublicId,
        postAuthorPublicId,
      });
    }
  }

  private async validatePostExists(publicId: string): Promise<IPost> {
    const post = await this.postReadRepository.findByPublicId(
      asPostPublicId(publicId),
    );
    if (!post) throw new PostNotFoundError();
    return post;
  }

  private async validateUserExists(publicId: string): Promise<IUser> {
    const user = await this.userReadRepository.findByPublicId(
      asUserPublicId(publicId),
    );
    if (!user) throw new UserNotFoundError();
    return user;
  }

  private async validateDeletePermission(
    requester: IUser,
    post: IPost,
  ): Promise<void> {
    const ownerId = post.user?.toString();
    if (ownerId === requester.id || requester.isAdmin) return;
    if (post.communityId) {
      const member =
        await this.communityMemberRepository.findByCommunityAndUser(
          post.communityId,
          requester._id as unknown as string,
        );
      if (member?.role === "admin" || member?.role === "moderator") return;
    }
    throw new PostAuthorizationError();
  }
}
