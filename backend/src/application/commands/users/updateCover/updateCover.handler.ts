import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { UpdateCoverCommand } from "./updateCover.command";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import type { IImageStorageService } from "@/types";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { RedisService } from "@/services/redis.service";
import { DTOService, PublicUserDTO } from "@/services/dto.service";
import { RetryPresets, RetryService } from "@/services/retry.service";
import { Errors, wrapError } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { UserCoverChangedEvent } from "@/application/events/user/user-interaction.event";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UpdateCoverCommandHandler implements ICommandHandler<
  UpdateCoverCommand,
  PublicUserDTO
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Services.Retry) private readonly retryService: RetryService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(command: UpdateCoverCommand): Promise<PublicUserDTO> {
    if (!command.fileBuffer) {
      throw Errors.validation("Cover file is required");
    }

    const user = await this.userReadRepository.findByPublicId(
      command.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    let newCoverUrl: string | null = null;
    let newCoverPublicId: string | null = null;
    const oldCoverUrl = user.cover ?? null;
    const userPublicId = user.publicId;

    try {
      const uploadResult = await this.imageStorageService.uploadImageStream(
        {
          buffer: command.fileBuffer,
          originalName: command.originalName,
          mimeType: command.mimeType,
        },
        userPublicId,
      );
      newCoverUrl = uploadResult.url;
      newCoverPublicId = uploadResult.publicId;
    } catch (error) {
      throw Errors.storage(
        error instanceof Error ? error.message : "Failed to upload cover",
      );
    }

    try {
      await this.unitOfWork.executeInTransaction(async () => {
        const userId = user.id;

        await this.userWriteRepository.updateCover(userId, newCoverUrl!);
      });

      await this.deleteOldCoverAfterCommit(userPublicId, oldCoverUrl);

      await this.redisService.invalidateByTags([`user_data:${userPublicId}`]);

      const coverChangedEvent = new UserCoverChangedEvent(
        userPublicId,
        oldCoverUrl || undefined,
        newCoverUrl || undefined,
      );
      await this.eventBus.publish(coverChangedEvent);

      const updatedUser = await this.userReadRepository.findByPublicId(
        command.userPublicId,
      );
      if (!updatedUser) {
        throw Errors.notFound("User");
      }

      const postCount = await this.postReadRepository.countDocuments({
        user: updatedUser.id,
      });
      updatedUser.postCount = postCount;

      return this.dtoService.toPublicDTO(updatedUser);
    } catch (error) {
      if (newCoverPublicId) {
        try {
          await this.imageStorageService.deleteImage(newCoverPublicId);
        } catch (deleteError) {
          logger.error("failed to clean up new cover", { error: deleteError });
        }
      }

      if (error instanceof Error) {
        throw wrapError(error);
      }
      throw Errors.internal("An unknown error occurred");
    }
  }

  private async deleteOldCoverAfterCommit(
    userPublicId: string,
    oldCoverUrl: string | null,
  ): Promise<void> {
    if (!oldCoverUrl) {
      return;
    }

    try {
      await this.retryService.execute(
        () =>
          this.imageStorageService.deleteAssetByUrl(
            userPublicId,
            userPublicId,
            oldCoverUrl,
          ),
        RetryPresets.externalApi(),
      );
    } catch (deleteError) {
      logger.warn(`failed to delete old cover: ${oldCoverUrl}`, {
        error: deleteError,
      });
    }
  }
}
