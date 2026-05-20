import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { SendMessageCommand } from "./sendMessage.command";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { DTOService } from "@/services/dto.service";
import { EventBus } from "@/application/common/buses/event.bus";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { Errors, wrapError } from "@/utils/errors";
import {
  buildParticipantHash,
  getParticipantIds,
  asPopulatedMessage,
} from "@/utils/messaging-helpers";
import { sanitizeTextInput } from "@/utils/sanitizers";
import { isUserViewingConversation } from "@/server/socketServer";
import { IImageStorageService, MessageDTO, toObjectId } from "@/types";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";
import {
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
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
  ) {}

  async execute(command: SendMessageCommand): Promise<MessageDTO> {
    try {
      const { senderPublicId, payload, file } = command;

      const hasContent =
        (payload.body && payload.body.trim().length > 0) ||
        (payload.attachments && payload.attachments.length > 0) ||
        !!file;

      if (!hasContent) {
        throw Errors.validation(
          "Message must contain either text or an attachment",
        );
      }

      if (file) {
        if (!file.mimetype.startsWith("image/")) {
          throw Errors.validation("Only image files are allowed");
        }
      }

      const currentAttachmentsCount = payload.attachments
        ? payload.attachments.length
        : 0;
      const newFileCount = file ? 1 : 0;
      if (currentAttachmentsCount + newFileCount > 5) {
        throw Errors.validation("Maximum of 5 attachments allowed per message");
      }

      if (payload.attachments) {
        for (const attachment of payload.attachments) {
          if (attachment.type !== "image") {
            throw Errors.validation("Only image attachments are allowed");
          }
        }
      }

      let sanitizedBody: string;
      try {
        sanitizedBody = sanitizeTextInput(payload.body, {
          maxLength: 5000,
          allowEmpty: true,
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

      let targetConversation = payload.conversationPublicId
        ? await this.conversationRepository.findByPublicId(
            payload.conversationPublicId,
            { populateParticipants: true },
          )
        : null;

      if (!targetConversation && !payload.recipientPublicId) {
        throw Errors.validation(
          "Recipient is required when no conversation is provided",
        );
      }

      let attachments = payload.attachments || [];
      if (file) {
        const convIdForPath = targetConversation
          ? targetConversation.publicId
          : "initial";
        const uploadPath = `${senderPublicId}/${convIdForPath}`;

        const { url } = await this.imageStorageService.uploadImageStream(
          {
            buffer: file.buffer,
            originalName: file.originalname,
            mimeType: file.mimetype,
          },
          senderPublicId,
          uploadPath,
        );
        attachments.push({
          url,
          type: "image",
          mimeType: file.mimetype,
        });
      }

      const messageDoc = await this.unitOfWork.executeInTransaction(
        async () => {
          let conversationDoc = targetConversation;

          if (conversationDoc) {
            await this.messageRepository.markConversationMessagesAsRead(
              toObjectId(conversationDoc._id).toString(),
              senderInternalId,
            );

            await this.conversationRepository.resetUnreadCount(
              toObjectId(conversationDoc._id).toString(),
              senderInternalId,
            );
          }

          if (!conversationDoc) {
            const recipientInternalId = await requireUserInternalId(
              this.userReadRepository,
              payload.recipientPublicId!,
            );

            const participantIds = [senderInternalId, recipientInternalId];
            const participantHash = buildParticipantHash(participantIds);

            conversationDoc =
              await this.conversationRepository.findByParticipantHash(
                participantHash,
              );

            if (!conversationDoc) {
              const participantObjectIds = participantIds.map(
                (id) => new mongoose.Types.ObjectId(id),
              );
              const unreadSeed = new Map<string, number>(
                participantIds.map((id) => [
                  id,
                  id === senderInternalId ? 0 : 1,
                ]),
              );

              conversationDoc = await this.conversationRepository.create({
                participantHash,
                participants: participantObjectIds,
                lastMessageAt: new Date(),
                unreadCounts: unreadSeed,
              });
            }
          } else {
            const existingParticipantIds = getParticipantIds(
              conversationDoc.participants,
            );
            if (!new Set(existingParticipantIds).has(senderInternalId)) {
              throw Errors.forbidden(
                "You do not have access to this conversation",
              );
            }
          }

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
            attachments:
              Array.isArray(attachments) && attachments.length > 0
                ? attachments.map((attachment) => ({ ...attachment }))
                : undefined,
            readBy: [new mongoose.Types.ObjectId(senderInternalId)],
            status: "sent",
          });

          await this.conversationRepository.findOneAndUpdate(
            { _id: conversationDoc!._id },
            {
              $set: {
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
          const recipientViewingStates = await Promise.all(
            recipients.map(async (recipientId) => ({
              recipientId,
              isViewingConversation: await isUserViewingConversation(
                recipientId,
                conversationDoc!.publicId,
              ),
            })),
          );
          const recipientsNeedingNotification = recipientViewingStates
            .filter(({ isViewingConversation }) => !isViewingConversation)
            .map(({ recipientId }) => recipientId);

          if (recipientsNeedingNotification.length > 0) {
            await Promise.all(
              recipientsNeedingNotification.map((recipientId) =>
                this.commandBus.dispatch(
                  new CreateNotificationCommand({
                    receiverId: recipientId,
                    actionType: "message",
                    actorId: senderPublicId,
                    actorUsername: populatedMessage.sender?.username,
                    actorHandle: populatedMessage.sender?.handle,
                    actorAvatar: populatedMessage.sender?.avatar,
                    targetId: conversationDoc!.publicId,
                    targetType: "conversation",
                    targetPreview:
                      sanitizedBody.substring(0, 50) +
                      (sanitizedBody.length > 50 ? "..." : ""),
                  }),
                ),
              ),
            );
          }

          await this.eventBus.queueTransactional(
            new MessageSentEvent(
              conversationDoc!.publicId,
              senderPublicId,
              recipients,
              message.publicId,
            ),
          );

          targetConversation = conversationDoc;
          return message;
        },
      );

      if (!targetConversation) {
        throw Errors.internal(
          "Conversation context missing after message creation",
        );
      }

      return this.dtoService.toPublicMessageDTO(
        messageDoc,
        targetConversation.publicId,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AppError") throw error;
      throw wrapError(error, "InternalServerError", {
        context: { operation: "sendMessage" },
      });
    }
  }
}
