import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetConversationMessagesQuery } from "./getConversationMessages.query";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { DTOService } from "@/services/dto.service";
import { EventBus } from "@/application/common/buses/event.bus";
import { MessageStatusUpdatedEvent } from "@/application/events/message/message.event";
import { wrapError } from "@/utils/errors";
import { PaginatedMessageResult } from "@/types";
import {
  ensureConversationAccess,
  resolveParticipantPublicIds,
} from "@/application/messaging/messaging-support";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetConversationMessagesQueryHandler implements IQueryHandler<
  GetConversationMessagesQuery,
  PaginatedMessageResult
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
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
  ) {}

  async execute(
    query: GetConversationMessagesQuery,
  ): Promise<PaginatedMessageResult> {
    try {
      const {
        userPublicId,
        conversationPublicId,
        page = 1,
        limit = 30,
      } = query;

      const { conversation, userInternalId, participantIds } =
        await ensureConversationAccess(
          this.conversationRepository,
          this.userReadRepository,
          userPublicId,
          conversationPublicId,
        );
      const conversationId = conversation._id.toString();

      if (page === 1) {
        await this.unitOfWork.executeInTransaction(async () => {
          const updated =
            await this.messageRepository.markConversationMessagesAsDelivered(
              conversationId,
              userInternalId,
            );
          if (!updated) {
            return;
          }

          const participantPublicIds = await resolveParticipantPublicIds(
            this.userReadRepository,
            participantIds,
          );

          await this.eventBus.queueTransactional(
            new MessageStatusUpdatedEvent(
              conversation.publicId,
              participantPublicIds,
              "delivered",
            ),
          );
        });
      }

      const result = await this.messageRepository.findMessagesByConversation(
        conversationId,
        page,
        limit,
      );
      const messages = result.data
        .slice()
        .reverse()
        .map((message) =>
          this.dtoService.toPublicMessageDTO(message, conversation.publicId),
        );

      return {
        messages,
        total: result.total,
        page,
        limit,
        totalPages: result.totalPages,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "getConversationMessages" },
      });
    }
  }
}
