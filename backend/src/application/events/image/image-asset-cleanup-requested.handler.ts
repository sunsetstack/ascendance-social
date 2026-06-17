import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { ImageService } from "@/services/image.service";
import { RetryPresets, RetryService } from "@/services/retry.service";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ImageAssetCleanupRequestedHandler
  implements IEventHandler<ImageAssetCleanupRequestedEvent>
{
  constructor(
    @inject(TOKENS.Services.Image) private readonly imageService: ImageService,
    @inject(TOKENS.Services.Retry) private readonly retryService: RetryService,
  ) {}

  async handle(event: ImageAssetCleanupRequestedEvent): Promise<void> {
    logger.info("[ImageAssetCleanup] Cleaning up storage asset", {
      reason: event.reason,
      storagePublicId: event.storagePublicId,
      url: event.url,
    });

    const storagePublicId = event.storagePublicId;
    if (storagePublicId) {
      await this.retryService.execute(
        () => this.imageService.deleteUploadedAsset(storagePublicId),
        RetryPresets.externalApi(),
      );
      return;
    }

    if (event.url && event.requesterPublicId && event.ownerPublicId) {
      await this.retryService.execute(
        () =>
          this.imageService.deleteAttachmentAsset({
            requesterPublicId: event.requesterPublicId!,
            ownerPublicId: event.ownerPublicId!,
            url: event.url!,
          }),
        RetryPresets.externalApi(),
      );
      return;
    }

    throw Errors.internal("Image cleanup event missing storage identifier", {
      context: {
        reason: event.reason,
        hasStoragePublicId: Boolean(event.storagePublicId),
        hasUrl: Boolean(event.url),
      },
    });
  }
}
