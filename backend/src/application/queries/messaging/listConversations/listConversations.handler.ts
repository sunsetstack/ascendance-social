import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { ListConversationsQuery } from "./listConversations.query";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserRepository } from "@/repositories/user.repository";
import { DTOService } from "@/services/dto.service";
import { PaginatedConversationSummaryResult } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import {
  mapConversationSummary,
  requireUserInternalId,
} from "@/application/messaging/messaging-support";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ListConversationsQueryHandler
  implements IQueryHandler<
    ListConversationsQuery,
    PaginatedConversationSummaryResult
  >
{
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: ListConversationsQuery,
  ): Promise<PaginatedConversationSummaryResult> {
    try {
      const { userPublicId, page = 1, limit = 20 } = query;

      const userInternalId = await requireUserInternalId(
        this.userRepository,
        userPublicId,
      );

      const result = await this.conversationRepository.findUserConversations(
        userInternalId,
        page,
        limit,
      );
      const conversations = result.data.map((conversation) =>
        mapConversationSummary(this.dtoService, conversation, userInternalId),
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
