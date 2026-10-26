import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { DeleteMessageCommand } from "./deleteMessage.command";
import { MessageRepository } from "@/repositories/message.repository";
import { ConversationRepository } from "@/repositories/conversation.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  assertMessageOwnedByUser,
  requireMessage,
  requireWritableMessageConversation,
  requireUserInternalId,
} from "@/application/messaging/messaging-support";

@injectable()
export class DeleteMessageCommandHandler implements ICommandHandler<
  DeleteMessageCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(command: DeleteMessageCommand): Promise<void> {
    try {
      const { userPublicId, messageId } = command;

      await this.unitOfWork.executeInTransaction(async () => {
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

        await requireWritableMessageConversation(
          this.conversationRepository,
          message,
          userInternalId,
        );
        await this.messageRepository.updateMessage(messageId, {
          body: "message deleted by user",
          attachments: [],
        });
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "deleteMessage" },
      });
    }
  }
}
