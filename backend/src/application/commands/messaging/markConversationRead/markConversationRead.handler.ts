import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { MarkConversationReadCommand } from "./markConversationRead.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork, sessionALS } from "@/database/UnitOfWork";
import { EventBus } from "@/application/common/buses/event.bus";
import { MessageStatusUpdatedEvent } from "@/application/events/message/message.event";
import { Errors, wrapError } from "@/utils/errors";
import { getParticipantIds } from "@/utils/messaging-helpers";
import { toObjectId, UserPublicIdLean } from "@/types";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";

@injectable()
export class MarkConversationReadCommandHandler
  implements ICommandHandler<MarkConversationReadCommand, void>
{
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  private async ensureConversationAccess(
    userPublicId: string,
    conversationPublicId: string,
  ) {
    const conversation = await this.conversationRepository.findByPublicId(
      conversationPublicId,
      { populateParticipants: true },
    );

    if (!conversation) {
      throw Errors.notFound("Conversation");
    }

    const userInternalId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userInternalId) {
      throw Errors.notFound("User");
    }

    const participantIds = getParticipantIds(conversation.participants);

    if (!new Set(participantIds).has(userInternalId)) {
      throw Errors.forbidden("You do not have access to this conversation");
    }

    return conversation;
  }

  async execute(command: MarkConversationReadCommand): Promise<void> {
    try {
      const { userPublicId, conversationPublicId } = command;

      const conversation = await this.ensureConversationAccess(
        userPublicId,
        conversationPublicId,
      );
      const userInternalId =
        await this.userRepository.findInternalIdByPublicId(userPublicId);
      if (!userInternalId) {
        throw Errors.notFound("User");
      }

      await this.unitOfWork.executeInTransaction(async () => {
        const conversationId = toObjectId(conversation._id).toString();
        await this.messageRepository.markConversationMessagesAsRead(
          conversationId,
          userInternalId,
        );
        await this.conversationRepository.resetUnreadCount(
          conversationId,
          userInternalId,
        );

        const participantIds = getParticipantIds(conversation.participants);
        const participantObjectIds = participantIds.map(
          (participantId) => new mongoose.Types.ObjectId(participantId),
        );
        const alsSession = sessionALS.getStore() ?? null;
        const participantDocs = await this.userRepository
          .find({ _id: { $in: participantObjectIds } })
          .select("publicId")
          .session(alsSession)
          .lean<UserPublicIdLean[]>()
          .exec();
        const participantPublicIds = participantDocs
          .map((doc) => doc.publicId)
          .filter(Boolean);

        await this.eventBus.queueTransactional(
          new MessageStatusUpdatedEvent(
            conversation.publicId,
            participantPublicIds,
            "read",
          ),
        );
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "markConversationRead" },
      });
    }
  }
}
