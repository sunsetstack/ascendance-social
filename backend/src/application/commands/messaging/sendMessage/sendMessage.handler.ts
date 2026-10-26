import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { SendMessageCommand } from "./sendMessage.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { DTOService } from "@/services/dto.service";
import { EventBus } from "@/application/common/buses/event.bus";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { Errors, wrapError } from "@/utils/errors";
import {
  buildParticipantHash,
  getParticipantIds,
  asPopulatedMessage,
} from "@/utils/messaging-helpers";
import { sanitizeTextInput } from "@/utils/sanitizers";
import { MessageDTO, toObjectId } from "@/types";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";
import { asMongoId } from "@/types/branded";
import {
  getConversationClearedAt,
  requireUserInternalId,
  resolveParticipantPublicIds,
} from "@/application/messaging/messaging-support";

@injectable()
export class SendMessageCommandHandler implements ICommandHandler<
  SendMessageCommand,
  MessageDTO
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

  async execute(command: SendMessageCommand): Promise<MessageDTO> {
    try {
      const { senderPublicId, payload, file } = command;

      if (file || (payload.attachments?.length ?? 0) > 0) {
        throw Errors.validation("Message attachments are not supported");
      }
      if (!payload.body?.trim()) {
        throw Errors.validation("Message body cannot be empty");
      }

      let sanitizedBody: string;
      try {
        sanitizedBody = sanitizeTextInput(payload.body, {
          maxLength: 5000,
          allowEmpty: false,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid message body";
        throw Errors.validation(message);
      }

      const senderInternalId = await requireUserInternalId(
        this.userReadRepository,
        senderPublicId,
      );

      if (!payload.conversationPublicId && !payload.recipientPublicId) {
        throw Errors.validation("Recipient is required when no conversation is provided");
      }
      if (
        !payload.conversationPublicId &&
        payload.recipientPublicId === senderPublicId
      ) {
        throw Errors.validation("You cannot start a conversation with yourself");
      }

      const { message, conversationPublicId } =
        await this.unitOfWork.executeInTransaction(async () => {
          let createdConversation = false;
          let conversationDoc = payload.conversationPublicId
            ? await this.conversationRepository.acquireForMutation(payload.conversationPublicId)
            : null;

          if (!conversationDoc) {
            if (!payload.recipientPublicId) {
              throw Errors.validation("Recipient is required");
            }
            const recipient = await this.userReadRepository.findByPublicId(
              payload.recipientPublicId,
            );
            if (!recipient || recipient.isBanned) {
              throw Errors.notFound("User");
            }
            const recipientInternalId = asMongoId(recipient.id);
            const participantIds = [senderInternalId, recipientInternalId];
            const participantHash = buildParticipantHash(participantIds);
            const existing = await this.conversationRepository.findByParticipantHash(participantHash);
            if (existing) {
              conversationDoc = await this.conversationRepository.acquireForMutation(existing.publicId);
            } else {
              conversationDoc = await this.conversationRepository.create({
                  participantHash,
                  participants: participantIds.map((id) => new mongoose.Types.ObjectId(id)),
                  lastMessageAt: new Date(),
                  unreadCounts: new Map(participantIds.map((id) => [id, 0])),
                });
              createdConversation = true;
            }
          }
          if (!getParticipantIds(conversationDoc.participants).includes(senderInternalId)) {
            throw Errors.forbidden("You do not have access to this conversation");
          }
          if (conversationDoc.isLocked) throw Errors.forbidden("Conversation locked by admin");
          if (conversationDoc.isClosed) {
            throw Errors.validation("This conversation is closed because a participant is unavailable");
          }
          if (!createdConversation) await this.messageRepository.markConversationMessagesAsRead(
            conversationDoc._id.toString(), senderInternalId,
            getConversationClearedAt(conversationDoc, senderInternalId),
          );

          const participantIds: string[] = getParticipantIds(
            conversationDoc!.participants,
          );

          const recipientInternalIds: string[] = participantIds.filter(
            (id: string) => id !== senderInternalId,
          );

          const conversationId = toObjectId(conversationDoc!._id).toString();
          const message = await this.messageRepository.create({
            conversation: new mongoose.Types.ObjectId(conversationId),
            sender: new mongoose.Types.ObjectId(senderInternalId),
            body: sanitizedBody,
            readBy: [new mongoose.Types.ObjectId(senderInternalId)],
            status: "sent",
            createdAt: new Date(Math.max(Date.now(), (conversationDoc.lastMessageAt?.getTime() ?? 0) + 1)),
          });

          await this.conversationRepository.findOneAndUpdate(
            { _id: conversationDoc!._id },
            {
              $set: {
                hiddenFor: [],
                lastMessage: message._id,
                lastMessageAt: message.createdAt,
                [`unreadCounts.${senderInternalId}`]: 0,
              },
              $inc: recipientInternalIds.reduce<Record<string, number>>(
                (acc: Record<string, number>, recipientId: string) => {
                  acc[`unreadCounts.${recipientId}`] = 1;
                  return acc;
                },
                {},
              ),
            },
          );

          await message.populate("sender", "publicId handle username avatar");
          const populatedMessage = asPopulatedMessage(message);

          const participantPublicIds = await resolveParticipantPublicIds(
            this.userReadRepository,
            participantIds,
          );

          const recipients = participantPublicIds.filter(
            (id: string) => id !== senderPublicId,
          );

          await this.eventBus.queueTransactional(
            new MessageSentEvent(
              conversationDoc!.publicId,
              senderPublicId,
              recipients,
              message.publicId,
              {
                actorUsername: populatedMessage.sender?.username,
                actorHandle: populatedMessage.sender?.handle,
                actorAvatar: populatedMessage.sender?.avatar,
                targetPreview:
                  sanitizedBody.substring(0, 50) +
                  (sanitizedBody.length > 50 ? "..." : ""),
              },
            ),
          );

          return { message, conversationPublicId: conversationDoc!.publicId };
        });

      return this.dtoService.toPublicMessageDTO(
        message,
        conversationPublicId,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "sendMessage" },
      });
    }
  }
}
