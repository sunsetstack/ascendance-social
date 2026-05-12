import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { MessageAttachmentsDeletedEvent } from "@/application/events/message/message.event";
import type { IImageStorageService } from "@/types";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class MessageAttachmentsDeletedHandler implements IEventHandler<MessageAttachmentsDeletedEvent> {
  constructor(
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
  ) {}

  async handle(event: MessageAttachmentsDeletedEvent): Promise<void> {
    const { attachmentPublicIds } = event;

    if (!attachmentPublicIds || attachmentPublicIds.length === 0) {
      return;
    }

    logger.info(
      `[MessageAttachmentsDeletedHandler] Processing deletion for ${attachmentPublicIds.length} attachments`,
    );

    // Execute deletions in parallel, but handle individual failures gracefully so one failure doesn't stop the rest
    const results = await Promise.allSettled(
      attachmentPublicIds.map((publicId) =>
        this.imageStorageService.deleteImage(publicId),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(
          `[MessageAttachmentsDeletedHandler] Failed to delete attachment: ${attachmentPublicIds[index]}`,
          {
            error: result.reason,
          },
        );
      } else {
        logger.info(
          `[MessageAttachmentsDeletedHandler] Successfully deleted attachment: ${attachmentPublicIds[index]}`,
        );
      }
    });
  }
}
