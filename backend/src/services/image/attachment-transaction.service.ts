import { inject, injectable } from "tsyringe";
import type { AttachmentSummary, IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { UnitOfWork } from "@/database/UnitOfWork";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import { ImageService } from "@/services/image.service";
import { ImageUploadStrategySelector } from "./upload";
import { EventBus } from "@/application/common/buses/event.bus";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { logger } from "@/utils/winston";

export interface AttachmentUpload {
  imageBuffer?: Buffer;
  imageMimeType?: string;
  imageOriginalName?: string;
}

@injectable()
export class AttachmentTransactionService {
  constructor(
    @inject(TOKENS.Services.Image) private readonly images: ImageService,
    @inject(TOKENS.Repositories.UnitOfWork) private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly events: EventBus,
  ) {}

  async run<T>(input: AttachmentUpload, user: IUser, write: (image: AttachmentSummary | null) => Promise<T>): Promise<T> {
    const strategy = ImageUploadStrategySelector.from(input, this.images);
    const uploaded = strategy ? await strategy.upload(user.publicId) : null;
    try {
      return await this.unitOfWork.executeInTransaction(async () => {
        const attachment = uploaded ? await this.images.createImageRecord({
          url: uploaded.url, storagePublicId: uploaded.publicId,
          originalName: input.imageOriginalName ?? "attachment",
          userInternalId: String(user._id), width: uploaded.width, height: uploaded.height,
        }) : null;
        return write(attachment?.summary ?? null);
      });
    } catch (error) {
      if (uploaded && !(error instanceof AmbiguousTransactionCommitError)) {
        await this.events.queueDurable(new ImageAssetCleanupRequestedEvent("attachment-write-failed", uploaded.publicId))
          .catch((cleanupError) => logger.error("Failed to queue attachment cleanup", { error: cleanupError, storagePublicId: uploaded.publicId }));
        await this.images.rollbackUpload(uploaded.publicId);
      }
      throw error;
    }
  }
}
