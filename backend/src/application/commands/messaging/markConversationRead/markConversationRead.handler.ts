import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { MarkConversationReadCommand } from "./markConversationRead.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { MessageStatusUpdatedEvent } from "@/application/events/message/message.event";
import { wrapError } from "@/utils/errors";
import {
  ensureConversationAccess,
  resolveParticipantPublicIds,
} from "@/application/messaging/messaging-support";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class MarkConversationReadCommandHandler implements ICommandHandler<
  MarkConversationReadCommand,
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
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(command: MarkConversationReadCommand): Promise<void> {
    try {
      const { userPublicId, conversationPublicId } = command;

      const { conversation, userInternalId, participantIds } =
        await ensureConversationAccess(
          this.conversationRepository,
          this.userReadRepository,
          userPublicId,
          conversationPublicId,
        );

      await this.unitOfWork.executeInTransaction(async () => {
        const conversationId = conversation._id.toString();
        await this.messageRepository.markConversationMessagesAsRead(
          conversationId,
          userInternalId,
        );
        await this.conversationRepository.resetUnreadCount(
          conversationId,
          userInternalId,
        );

        const participantPublicIds = await resolveParticipantPublicIds(
          this.userReadRepository,
          participantIds,
        );

        await this.eventBus.queueTransactional(
          new MessageStatusUpdatedEvent(
            conversation.publicId,
            participantPublicIds,
            "read",
          ),
        );
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "markConversationRead" },
      });
    }
  }
}
