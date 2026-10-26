import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { EditMessageCommand } from "./editMessage.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors, wrapError } from "@/utils/errors";
import { sanitizeTextInput } from "@/utils/sanitizers";
import { MessageDTO } from "@/types";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { asMongoId } from "@/types/branded";
import {
  assertMessageOwnedByUser,
  requireMessage,
  requireWritableMessageConversation,
  requireUserInternalId,
} from "@/application/messaging/messaging-support";

@injectable()
export class EditMessageCommandHandler implements ICommandHandler<
  EditMessageCommand,
  MessageDTO
> {
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(command: EditMessageCommand): Promise<MessageDTO> {
    try {
      const { userPublicId, messageId, newBody } = command;

      return await this.unitOfWork.executeInTransaction(async () => {
        const userInternalId = await requireUserInternalId(
          this.userReadRepository,
          userPublicId,
        );
        const message = await requireMessage(this.messageRepository, messageId);
        await requireWritableMessageConversation(
          this.conversationRepository,
          message,
          userInternalId,
        );
        assertMessageOwnedByUser(
          message,
          userPublicId,
          userInternalId,
          "You can only edit your own messages",
        );

        let sanitizedBody: string;
        try {
          sanitizedBody = sanitizeTextInput(newBody, {
            maxLength: 5000,
            allowEmpty: false,
          });
        } catch (sanitizeError) {
          const errorMsg =
            sanitizeError instanceof Error
              ? sanitizeError.message
              : "Invalid message body";
          throw Errors.validation(errorMsg);
        }

        const updatedMessage = await this.messageRepository.updateMessage(
          messageId,
          { body: sanitizedBody },
        );
        if (!updatedMessage) {
          throw Errors.internal("Failed to update message");
        }

        const conversation = await this.conversationRepository.findById(
          asMongoId(updatedMessage.conversation.toString()),
        );
        if (!conversation) {
          throw Errors.internal("Conversation not found");
        }

        return this.dtoService.toPublicMessageDTO(
          updatedMessage,
          conversation.publicId,
        );
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "editMessage" },
      });
    }
  }
}
