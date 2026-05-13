import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { EditMessageCommand } from "./editMessage.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { UserRepository } from "@/repositories/user.repository";
import { DTOService } from "@/services/dto.service";
import { Errors, wrapError } from "@/utils/errors";
import { isPopulatedSender } from "@/utils/messaging-helpers";
import { sanitizeTextInput } from "@/utils/sanitizers";
import { MessageDTO } from "@/types";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class EditMessageCommandHandler
  implements ICommandHandler<EditMessageCommand, MessageDTO>
{
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(command: EditMessageCommand): Promise<MessageDTO> {
    try {
      const { userPublicId, messageId, newBody } = command;

      const userInternalId =
        await this.userRepository.findInternalIdByPublicId(userPublicId);
      if (!userInternalId) {
        throw Errors.notFound("User");
      }

      const message = await this.messageRepository.findByPublicId(messageId);
      if (!message) {
        throw Errors.notFound("Resource");
      }

      const sender: unknown = message.sender;
      if (isPopulatedSender(sender)) {
        if (sender.publicId !== undefined && sender.publicId !== userPublicId) {
          throw Errors.forbidden("You can only edit your own messages");
        }
        const senderId = sender._id ? sender._id.toString() : "";
        if (senderId && senderId !== userInternalId) {
          throw Errors.forbidden("You can only edit your own messages");
        }
      } else {
        if (message.sender.toString() !== userInternalId) {
          throw Errors.forbidden("You can only edit your own messages");
        }
      }

      const hasAttachments =
        message.attachments && message.attachments.length > 0;
      const allowEmpty = hasAttachments;

      let sanitizedBody: string;
      try {
        sanitizedBody = sanitizeTextInput(newBody, {
          maxLength: 5000,
          allowEmpty,
        });
      } catch (sanitizeError) {
        const errorMsg =
          sanitizeError instanceof Error ? sanitizeError.message : "Invalid message body";
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
        updatedMessage.conversation.toString(),
      );
      if (!conversation) {
        throw Errors.internal("Conversation not found");
      }

      return this.dtoService.toPublicMessageDTO(
        updatedMessage,
        conversation.publicId,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "editMessage" },
      });
    }
  }
}
