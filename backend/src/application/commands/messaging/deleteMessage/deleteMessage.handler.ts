import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { DeleteMessageCommand } from "./deleteMessage.command";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { MessageAttachmentsDeletedEvent } from "@/application/events/message/message.event";
import { wrapError } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  assertMessageOwnedByUser,
  requireMessage,
  requireUserInternalId,
} from "@/application/messaging/messaging-support";

@injectable()
export class DeleteMessageCommandHandler implements ICommandHandler<
  DeleteMessageCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: DeleteMessageCommand): Promise<void> {
    try {
      const { userPublicId, messageId } = command;

      const userInternalId = await requireUserInternalId(
        this.userReadRepository,
        userPublicId,
      );
      const message = await requireMessage(this.messageRepository, messageId);
      assertMessageOwnedByUser(
        message,
        userPublicId,
        userInternalId,
        "You can only delete your own messages",
      );

      await this.unitOfWork.executeInTransaction(async () => {
        const attachmentPublicIds =
          message.attachments
            ?.map((att) => {
              const url = att.url;
              const cloudinaryMatch = url.match(
                /\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/,
              );
              if (cloudinaryMatch) return cloudinaryMatch[1];

              const localStorageMatch = url.match(/\/uploads\/(.+)$/);
              if (localStorageMatch) return localStorageMatch[1];

              logger.warn(
                "[MessagingService] Could not extract publicId from attachment URL, file may remain in storage",
                { url },
              );
              return null;
            })
            .filter((id): id is string => !!id) || [];

        await this.messageRepository.updateMessage(messageId, {
          body: "message deleted by user",
          attachments: [],
        });

        if (attachmentPublicIds.length > 0) {
          await this.eventBus.queueTransactional(
            new MessageAttachmentsDeletedEvent(attachmentPublicIds),
          );
        }
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "deleteMessage" },
      });
    }
  }
}
