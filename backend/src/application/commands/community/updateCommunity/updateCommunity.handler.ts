import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import { EventBus } from "@/application/common/buses/event.bus";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { UpdateCommunityCommand } from "./updateCommunity.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type {
  IUserReadRepository,
  IUserWriteRepository,
} from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import type {
  ICommunity,
  IImageStorageService,
  ImageUploadResult,
} from "@/types";
import { Errors } from "@/utils/errors";
import { generateSlug } from "@/utils/helpers";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import {
  asMongoId,
  asUserPublicId,
  asCommunityPublicId,
} from "@/types/branded";

@injectable()
export class UpdateCommunityCommandHandler implements ICommandHandler<
  UpdateCommunityCommand,
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
    @inject(TOKENS.Repositories.UnitOfWork) private readonly uow: UnitOfWork,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
    @inject(TOKENS.CQRS.Handlers.EventBus)
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: UpdateCommunityCommand): Promise<ICommunity> {
    const {
      communityId: communityPublicId,
      userId: userPublicId,
      updates,
    } = command;

    const community = await this.communityRepository.findByPublicId(
      asCommunityPublicId(communityPublicId),
    );
    if (!community) {
      throw Errors.notFound("Community");
    }
    const communityId = community._id as Types.ObjectId;
    const communityMongoId = asMongoId(communityId.toString());

    const user = await this.userReadRepository.findByPublicId(
      asUserPublicId(userPublicId),
    );
    if (!user) {
      throw Errors.notFound("User");
    }
    const userId = user._id as Types.ObjectId;

    // Check permissions (must be admin of the community)
    const member = await this.communityMemberRepository.findByCommunityAndUser(
      communityId,
      userId,
    );
    if (!member || member.role !== "admin") {
      throw Errors.validation("Only community admins can update settings");
    }

    // Prepare updates
    const updateData: Partial<ICommunity> = {};
    if (updates.description !== undefined)
      updateData.description = updates.description;

    if (updates.name) {
      updateData.name = updates.name;
      const newSlug = generateSlug(updates.name);

      // check slug uniqueness if changed
      const existing = await this.communityRepository.findBySlug(newSlug);
      if (
        existing &&
        existing._id.toString() !== asMongoId(communityId.toString())
      ) {
        throw Errors.validation("Community name is already taken");
      }
      updateData.slug = newSlug;
    }

    let uploadedAvatar: ImageUploadResult | undefined;
    let uploadedCoverPhoto: ImageUploadResult | undefined;

    if (updates.avatarBuffer) {
      try {
        uploadedAvatar = await this.imageStorageService.uploadImageStream(
          {
            buffer: updates.avatarBuffer,
            originalName: updates.avatarOriginalName,
            mimeType: updates.avatarMimeType,
          },
          community.publicId,
        );
        updateData.avatar = uploadedAvatar.url;
        updateData.avatarStoragePublicId = uploadedAvatar.publicId;
      } catch (error) {
        throw Errors.storage(
          error instanceof Error
            ? error.message
            : "Failed to upload community avatar",
          {
            cause: error,
            context: { operation: "upload-community-avatar" },
          },
        );
      }
    }

    if (updates.coverPhotoBuffer) {
      try {
        uploadedCoverPhoto = await this.imageStorageService.uploadImageStream(
          {
            buffer: updates.coverPhotoBuffer,
            originalName: updates.coverPhotoOriginalName,
            mimeType: updates.coverPhotoMimeType,
          },
          community.publicId,
        );
        updateData.coverPhoto = uploadedCoverPhoto.url;
        updateData.coverPhotoStoragePublicId = uploadedCoverPhoto.publicId;
      } catch (error) {
        await this.cleanupUploadedAssets(
          "community-update-upload-failed",
          [uploadedAvatar?.publicId],
          community.publicId,
        );
        throw Errors.storage(
          error instanceof Error
            ? error.message
            : "Failed to upload community cover photo",
          {
            cause: error,
            context: { operation: "upload-community-cover" },
          },
        );
      }
    }

    const shouldSyncJoinedCommunitySnapshot =
      updateData.name !== undefined ||
      updateData.slug !== undefined ||
      updateData.avatar !== undefined;

    const stagedStoragePublicIds = this.uniqueStoragePublicIds([
      uploadedAvatar?.publicId,
      uploadedCoverPhoto?.publicId,
    ]);

    try {
      return await this.uow.executeInTransaction(async () => {
        const currentCommunity =
          await this.communityRepository.findById(communityMongoId);
        if (!currentCommunity) {
          throw Errors.notFound("Community");
        }

        const updated = await this.communityRepository.update(
          communityMongoId,
          updateData,
        );
        if (!updated) {
          throw Errors.notFound("Community");
        }

        if (shouldSyncJoinedCommunitySnapshot) {
          await this.userWriteRepository.updateJoinedCommunitySnapshot(
            communityMongoId,
            {
              name: updated.name,
              slug: updated.slug,
              icon: updated.avatar,
            },
          );
        }

        const retainedStoragePublicIds = new Set(
          this.uniqueStoragePublicIds([
            updated.avatarStoragePublicId,
            updated.coverPhotoStoragePublicId,
          ]),
        );
        const replacedStoragePublicIds = this.uniqueStoragePublicIds([
          currentCommunity.avatarStoragePublicId,
          currentCommunity.coverPhotoStoragePublicId,
        ]).filter(
          (storagePublicId) =>
            !retainedStoragePublicIds.has(storagePublicId),
        );

        for (const storagePublicId of replacedStoragePublicIds) {
          await this.eventBus.queueTransactional(
            new ImageAssetCleanupRequestedEvent(
              "community-media-replaced",
              storagePublicId,
            ),
          );
        }

        return updated;
      });
    } catch (error) {
      if (
        stagedStoragePublicIds.length > 0 &&
        error instanceof AmbiguousTransactionCommitError
      ) {
        logger.warn(
          "Preserving community media after ambiguous transaction commit",
          {
            error,
            communityPublicId: community.publicId,
            storagePublicIds: stagedStoragePublicIds,
          },
        );
      } else if (stagedStoragePublicIds.length > 0) {
        await this.cleanupUploadedAssets(
          "community-update-failed",
          stagedStoragePublicIds,
          community.publicId,
        );
      }
      throw error;
    }
  }

  private uniqueStoragePublicIds(
    values: Array<string | null | undefined>,
  ): string[] {
    return Array.from(
      new Set(
        values.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        ),
      ),
    );
  }

  private async cleanupUploadedAssets(
    reason: string,
    storagePublicIds: Array<string | null | undefined>,
    communityPublicId: string,
  ): Promise<void> {
    for (const storagePublicId of this.uniqueStoragePublicIds(
      storagePublicIds,
    )) {
      await this.eventBus
        .queueDurable(
          new ImageAssetCleanupRequestedEvent(reason, storagePublicId),
        )
        .catch((error) => {
          logger.error("Failed to queue community media cleanup", {
            error,
            reason,
            storagePublicId,
            communityPublicId,
          });
        });

      try {
        await this.imageStorageService.deleteImage(storagePublicId);
      } catch (error) {
        logger.error("Failed to rollback community media upload", {
          error,
          reason,
          storagePublicId,
          communityPublicId,
        });
      }
    }
  }
}
