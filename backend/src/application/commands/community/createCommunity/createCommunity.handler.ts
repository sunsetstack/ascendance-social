import { inject, injectable } from "tsyringe";
import { Types, UpdateQuery } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { CreateCommunityCommand } from "./createCommunity.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import { generateSlug } from "@/utils/helpers";
import { logger } from "@/utils/winston";
import { ICommunity, IUser } from "@/types";
import type { IImageStorageService } from "@/types";
import { TOKENS } from "@/types/tokens";

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
    @inject(UserRepository) private userRepository: UserRepository,
    @inject(UnitOfWork) private uow: UnitOfWork,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
  ) {}

  async execute(command: CreateCommunityCommand): Promise<ICommunity> {
    const { name, description, creatorId, avatarBuffer } = command;

    const user = await this.userRepository.findByPublicId(creatorId);
    if (!user) {
      throw Errors.notFound("User");
    }
    const userId = user._id as Types.ObjectId;

    const slug = generateSlug(name);

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
          slug,
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
          name,
          slug,
          description,
          avatar: avatarUrl,
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
        await this.userRepository.update(userId.toString(), {
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
      if (avatarPublicId) {
        try {
          await this.imageStorageService.deleteImage(avatarPublicId);
        } catch (deleteError) {
          logger.error("Failed to rollback community avatar upload", {
            error: deleteError,
          });
          throw Errors.storage(
            deleteError instanceof Error
              ? deleteError.message
              : "Failed to rollback community avatar upload",
          );
        }
      }
      throw error;
    }
  }
}
