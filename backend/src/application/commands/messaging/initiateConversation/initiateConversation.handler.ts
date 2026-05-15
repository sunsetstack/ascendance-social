import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { InitiateConversationCommand } from "./initiateConversation.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { DTOService } from "@/services/dto.service";
import { ConversationSummaryDTO, HydratedConversation, MaybePopulatedParticipant } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import { buildParticipantHash, extractParticipantId, extractUnreadCounts } from "@/utils/messaging-helpers";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";

@injectable()
export class InitiateConversationCommandHandler
  implements ICommandHandler<InitiateConversationCommand, ConversationSummaryDTO>
{
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
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

  async execute(command: InitiateConversationCommand): Promise<ConversationSummaryDTO> {
    try {
      const { userPublicId, recipientPublicId } = command;

      if (userPublicId === recipientPublicId) {
        throw Errors.validation("You cannot start a conversation with yourself");
      }

      const [userInternalId, recipientInternalId] = await Promise.all([
        this.userRepository.findInternalIdByPublicId(userPublicId),
        this.userRepository.findInternalIdByPublicId(recipientPublicId),
      ]);

      if (!userInternalId) {
        throw Errors.notFound("User");
      }

      if (!recipientInternalId) {
        throw Errors.notFound("User");
      }

      const participantIds = [userInternalId, recipientInternalId];
      const participantHash = buildParticipantHash(participantIds);

      let conversation =
        await this.conversationRepository.findByParticipantHash(participantHash);

      if (!conversation) {
        conversation = await this.unitOfWork.executeInTransaction(
          async () => {
            const participantObjectIds = participantIds.map(
              (id) => new mongoose.Types.ObjectId(id),
            );
            const unreadSeed = new Map<string, number>(
              participantIds.map((id) => [id, 0]),
            );

            return this.conversationRepository.create(
              {
                participantHash,
                participants: participantObjectIds,
                lastMessageAt: new Date(),
                unreadCounts: unreadSeed,
                isGroup: false,
              },
            );
          },
        );
      }

      const hydratedConversation =
        await this.conversationRepository.findByPublicId(
          conversation.publicId,
          {
            populateParticipants: true,
            includeLastMessage: true,
          },
        );

      if (!hydratedConversation) {
        throw Errors.internal("Conversation could not be loaded");
      }

      return this.mapConversationSummary(
        hydratedConversation as HydratedConversation,
        userInternalId,
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AppError') throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "initiateConversation" },
      });
    }
  }
}
