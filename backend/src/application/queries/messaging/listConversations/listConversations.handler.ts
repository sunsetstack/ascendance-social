import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { ListConversationsQuery } from "./listConversations.query";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserRepository } from "@/repositories/user.repository";
import { DTOService } from "@/services/dto.service";
import { ConversationSummaryDTO, HydratedConversation, MaybePopulatedParticipant } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import { extractParticipantId, extractUnreadCounts } from "@/utils/messaging-helpers";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ListConversationsQueryHandler
  implements IQueryHandler<ListConversationsQuery, any>
{
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  private mapConversationSummary(
    conversation: HydratedConversation,
    userInternalId: string,
  ): ConversationSummaryDTO {
    const unreadCounts = extractUnreadCounts(conversation.unreadCounts);
    const participants = Array.isArray(conversation.participants)
      ? conversation.participants
          .map((participant) => {
            if (participant instanceof mongoose.Types.ObjectId) {
              return { publicId: "", handle: "", username: "", avatar: "" };
            }
            const populatedParticipant = participant as MaybePopulatedParticipant;
            return {
              publicId:
                populatedParticipant?.publicId ??
                extractParticipantId(participant) ??
                "",
              handle: populatedParticipant?.handle ?? "",
              username: populatedParticipant?.username ?? "",
              avatar: populatedParticipant?.avatar ?? "",
            };
          })
          .filter((participant) => Boolean(participant.publicId))
      : [];

    const hasLastMessage =
      conversation.lastMessage &&
      (conversation.lastMessage.publicId || conversation.lastMessage._id);
    const lastMessage =
      hasLastMessage && conversation.lastMessage
        ? this.dtoService.toPublicMessageDTO(
            conversation.lastMessage,
            conversation.publicId,
          )
        : null;

    return {
      publicId: conversation.publicId,
      participants,
      lastMessage,
      lastMessageAt: conversation.lastMessageAt
        ? new Date(conversation.lastMessageAt).toISOString()
        : null,
      unreadCount: unreadCounts[userInternalId] || 0,
      isGroup: Boolean(conversation.isGroup),
      title: conversation.title,
    };
  }

  async execute(query: ListConversationsQuery): Promise<any> {
    try {
      const { userPublicId, page = 1, limit = 20 } = query;

      const userInternalId =
        await this.userRepository.findInternalIdByPublicId(userPublicId);
      if (!userInternalId) {
        throw Errors.notFound("User", userPublicId);
      }

      const result = await this.conversationRepository.findUserConversations(
        userInternalId,
        page,
        limit,
      );
      const conversations = result.data.map((conversation) =>
        this.mapConversationSummary(conversation, userInternalId),
      );

      return {
        conversations,
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "listConversations", userPublicId: query.userPublicId },
      });
    }
  }
}
