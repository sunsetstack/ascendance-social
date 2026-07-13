import { inject, injectable } from "tsyringe";
import { Model, Types } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { DeleteCommunityCommand } from "./deleteCommunity.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import {
  asMongoId,
  asUserPublicId,
  asCommunityPublicId,
} from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";
import { EventBus } from "@/application/common/buses/event.bus";
import { PostDeletedEvent } from "@/application/events/post/post.event";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { asPostPublicId } from "@/types/branded";
import { IUser } from "@/types";

@injectable()
export class DeleteCommunityCommandHandler implements ICommandHandler<
  DeleteCommunityCommand,
  void
> {
  constructor(
    @inject(CommunityRepository)
    private communityRepository: CommunityRepository,
    @inject(CommunityMemberRepository)
    private communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork) private uow: UnitOfWork,
    @inject(TOKENS.Services.ContentCleanup)
    private readonly contentCleanupService: ContentCleanupService,
    @inject(TOKENS.CQRS.Handlers.EventBus)
    private readonly eventBus: EventBus,
    @inject(TOKENS.Models.User)
    private readonly userModel: Model<IUser>,
  ) {}

  async execute(command: DeleteCommunityCommand): Promise<void> {
    const { communityId: communityPublicId, userId: userPublicId } = command;

    const community = await this.communityRepository.findByPublicId(
      asCommunityPublicId(communityPublicId),
    );
    if (!community) {
      throw Errors.notFound("Community");
    }
    const communityId = community._id as Types.ObjectId;

    const user = await this.userReadRepository.findByPublicId(
      asUserPublicId(userPublicId),
    );
    if (!user) {
      throw Errors.notFound("User");
    }
    const userId = user._id as Types.ObjectId;

    // 1. Check permissions
    const member = await this.communityMemberRepository.findByCommunityAndUser(
      communityId,
      userId,
    );
    if (!member || member.role !== "admin") {
      throw Errors.forbidden("Only community admins can delete the community");
    }

    await this.uow.executeInTransaction(async (session) => {
      const postIds =
        await this.contentCleanupService.findPostIdsByCommunity(communityId);
      const cleanup =
        await this.contentCleanupService.deletePostGraph(postIds);

      await this.communityMemberRepository.deleteByCommunityId(communityId);
      await this.communityRepository.delete(asMongoId(communityId.toString()));
      await this.userModel.updateMany(
        { "joinedCommunities._id": communityId },
        { $pull: { joinedCommunities: { _id: communityId } } },
        { session },
      );

      for (const post of cleanup.posts) {
        await this.eventBus.queueTransactional(
          new PostDeletedEvent(
            asPostPublicId(post.publicId),
            asUserPublicId(post.authorPublicId || userPublicId),
          ),
        );
      }
      for (const asset of cleanup.imageAssets) {
        await this.eventBus.queueTransactional(
          new ImageAssetCleanupRequestedEvent(
            "community-deleted",
            asset.storagePublicId,
            asset.url,
            asUserPublicId(userPublicId),
            asUserPublicId(asset.ownerPublicId || userPublicId),
          ),
        );
      }
    });
  }
}
