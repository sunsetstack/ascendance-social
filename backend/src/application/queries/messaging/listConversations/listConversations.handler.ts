import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { ListConversationsQuery } from "./listConversations.query";
import { ConversationRepository } from "@/repositories/conversation.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import { PaginatedConversationSummaryResult } from "@/types";
import { wrapError } from "@/utils/errors";
import {
  mapConversationSummary,
  requireUserInternalId,
} from "@/application/messaging/messaging-support";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ListConversationsQueryHandler implements IQueryHandler<
  ListConversationsQuery,
  PaginatedConversationSummaryResult
> {
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(
    query: ListConversationsQuery,
  ): Promise<PaginatedConversationSummaryResult> {
    try {
      const { userPublicId, page = 1, limit = 20 } = query;

      const userInternalId = await requireUserInternalId(
        this.userReadRepository,
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
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: {
          operation: "listConversations",
          userPublicId: query.userPublicId,
        },
      });
    }
  }
}
