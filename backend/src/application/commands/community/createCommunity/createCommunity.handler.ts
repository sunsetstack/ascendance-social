import { inject, injectable } from "tsyringe";
import { Types, UpdateQuery } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { EventBus } from "@/application/common/buses/event.bus";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { CreateCommunityCommand } from "./createCommunity.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type {
  IUserReadRepository,
  IUserWriteRepository,
} from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import { Errors } from "@/utils/errors";
import { generateSlug } from "@/utils/helpers";
import { logger } from "@/utils/winston";
import { ICommunity, IUser } from "@/types";
import type { IImageStorageService } from "@/types";
import { TOKENS } from "@/types/tokens";
import {
  asCommunityPublicId,
  asMongoId,
  asUserPublicId,
} from "@/types/branded";

@injectable()
export class CreateCommunityCommandHandler implements ICommandHandler<
  CreateCommunityCommand,
  ICommunity
> {
  constructor(
    @inject(CommunityRepository)
    private communityRepository: CommunityRepository,
    @inject(CommunityMemberRepository)
    private communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.UnitOfWork) private uow: UnitOfWork,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
    @inject(TOKENS.CQRS.Handlers.EventBus)
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateCommunityCommand): Promise<ICommunity> {
    const { name, description, creatorId, avatarBuffer } = command;

    const user = await this.userReadRepository.findByPublicId(
      asUserPublicId(creatorId),
    );
    if (!user) {
      throw Errors.notFound("User");
    }
    const userId = user._id as Types.ObjectId;

    const slug = generateSlug(name);
    const publicId = asCommunityPublicId(uuidv4());

    // Check if slug exists
    const existing = await this.communityRepository.findBySlug(slug);
    if (existing) {
      throw Errors.validation("Community with this name already exists");
    }

    let avatarUrl = "";
    let avatarPublicId = "";

    if (avatarBuffer) {
      try {
        const uploadResult = await this.imageStorageService.uploadImageStream(
          {
            buffer: command.avatarBuffer!,
            originalName: command.avatarOriginalName,
            mimeType: command.avatarMimeType,
          },
          publicId,
        );
        avatarUrl = uploadResult.url;
        avatarPublicId = uploadResult.publicId;
      } catch (error) {
        logger.error("Failed to upload community avatar", { error });
        throw Errors.storage(
          error instanceof Error
            ? error.message
            : "Failed to upload community avatar",
        );
      }
    }

    try {
      return await this.uow.executeInTransaction(async () => {
        // 1. Create Community
        const community = await this.communityRepository.create({
          publicId,
          name,
          slug,
          description,
          avatar: avatarUrl,
          ...(avatarPublicId
            ? { avatarStoragePublicId: avatarPublicId }
            : {}),
          creatorId: userId,
          stats: { memberCount: 1, postCount: 0 },
        });

        // 2. Add Creator as Admin
        await this.communityMemberRepository.create({
          communityId: community._id,
          userId: userId,
          role: "admin",
        });

        // 3. Update User Cache
        await this.userWriteRepository.update(asMongoId(userId.toString()), {
          $push: {
            joinedCommunities: {
              $each: [
                {
                  _id: community._id,
                  name: community.name,
                  slug: community.slug,
                },
              ],
              $position: 0,
              $slice: 10,
            },
          },
        } as UpdateQuery<IUser>);

        return community;
      });
    } catch (error) {
      if (avatarPublicId && error instanceof AmbiguousTransactionCommitError) {
        logger.warn(
          "Preserving community avatar after ambiguous transaction commit",
          {
            error,
            storagePublicId: avatarPublicId,
            communityPublicId: publicId,
            slug,
          },
        );
      } else if (avatarPublicId) {
        await this.cleanupUploadedAsset(avatarPublicId, publicId, slug);
      }
      throw error;
    }
  }

  private async cleanupUploadedAsset(
    storagePublicId: string,
    communityPublicId: string,
    slug: string,
  ): Promise<void> {
    await this.eventBus
      .queueDurable(
        new ImageAssetCleanupRequestedEvent(
          "community-create-failed",
          storagePublicId,
        ),
      )
      .catch((error) => {
        logger.error("Failed to queue community avatar cleanup", {
          error,
          storagePublicId,
          communityPublicId,
          slug,
        });
      });

    try {
      await this.imageStorageService.deleteImage(storagePublicId);
    } catch (error) {
      logger.error("Failed to rollback community avatar upload", {
        error,
        storagePublicId,
        communityPublicId,
        slug,
      });
    }
  }
}
