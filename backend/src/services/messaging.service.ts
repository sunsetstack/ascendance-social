import mongoose from "mongoose";
import { inject, injectable } from "tsyringe";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork, sessionALS } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import {
  ConversationSummaryDTO,
  HydratedConversation,
  IMessage,
  IMessageWithPopulatedSender,
  MaybePopulatedParticipant,
  MessageDTO,
  PopulatedSender,
  SendMessagePayload,
  toObjectId,
  UserPublicIdLean,
} from "@/types";
import { DTOService } from "./dto.service";
import { EventBus } from "@/application/common/buses/event.bus";
import {
  MessageSentEvent,
  MessageStatusUpdatedEvent,
  MessageAttachmentsDeletedEvent,
} from "@/application/events/message/message.event";
import { NotificationService } from "./notification.service";
import { sanitizeTextInput } from "@/utils/sanitizers";
import { logger } from "@/utils/winston";
import { isUserViewingConversation } from "../server/socketServer";
import type { IImageStorageService } from "@/types";
import { TOKENS } from "@/types/tokens";

/*
Notes on messaging system:

	Storing each message as its own MongoDB document is okay at moderate scale,
	but if volume grows significantly, certain guardrails must be put into place.
	
	- Shard or partition by conversationId so Mongo splits write load and keeps indexes bounded; 
			enable hashed sharding on conversationId + createdAt.
	- Bound indexes (compound { conversationId: 1, createdAt: -1 }) and avoid multi-field text indexes on the hot collection.
	- Cold-storage tiers: keep only the latest N (e.g., 5–20 k) messages per conversation in the primary messages collection,
			then roll off older ones to an archive collection or object storage via scheduled jobs.
	- Paginated reads using time or snowflake IDs rather than skip/limit to keep queries O(1).
	- Soft deletes/retention policies (per workspace, per conversation) stop infinite growth.
	- Attachment offloading: store blob metadata only; push files to S3/Cloudinary/other storage. 
			Just not in the message document itself.
	- Compression: enable MognoDB's WiredTiger block compression and keep payloads trimmed to reduce storage footprint.

	With sharding plus archival and retention policies, single-document messages remain manageable even at scale.
	For the current needs of the app, i'm keeping this approach. It's simple and fexible and I don't plan on
	having thousands of active users with millions of messages each. 
	This whole project is proof of concept. 
*/

@injectable()
export class MessagingService {
  constructor(
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Notification)
    private readonly notificationService: NotificationService,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
  ) {}

  async listConversations(
    userPublicId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    conversations: ConversationSummaryDTO[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const userInternalId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userInternalId) {
      throw Errors.notFound("User");
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
  }

  async initiateConversation(
    userPublicId: string,
    recipientPublicId: string,
  ): Promise<ConversationSummaryDTO> {
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
    const participantHash = this.buildParticipantHash(participantIds);

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
  }

  async getConversationMessages(
    userPublicId: string,
    conversationPublicId: string,
    page = 1,
    limit = 30,
  ): Promise<{
    messages: MessageDTO[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const conversation = await this.ensureConversationAccess(
      userPublicId,
      conversationPublicId,
    );
    const conversationId = toObjectId(conversation._id).toString();
    const userInternalId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userInternalId) {
      throw Errors.notFound("User");
    }

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

        const participantIds = this.getParticipantIds(
          conversation.participants,
        );
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
  }

  async markConversationRead(
    userPublicId: string,
    conversationPublicId: string,
  ): Promise<void> {
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

      const participantIds = this.getParticipantIds(conversation.participants);
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
  }

  async sendMessage(
    senderPublicId: string,
    payload: SendMessagePayload,
    file?: Express.Multer.File,
  ): Promise<MessageDTO> {
    const hasContent =
      (payload.body && payload.body.trim().length > 0) ||
      (payload.attachments && payload.attachments.length > 0) ||
      !!file;

    if (!hasContent) {
      throw Errors.validation("Message must contain either text or an attachment");
    }

    // Validate file type
    if (file) {
      if (!file.mimetype.startsWith("image/")) {
        throw Errors.validation("Only image files are allowed");
      }
    }

    // Validate total attachments count
    const currentAttachmentsCount = payload.attachments
      ? payload.attachments.length
      : 0;
    const newFileCount = file ? 1 : 0;
    if (currentAttachmentsCount + newFileCount > 5) {
      throw Errors.validation("Maximum of 5 attachments allowed per message");
    }

    // Validate existing attachments are images (if any)
    if (payload.attachments) {
      for (const attachment of payload.attachments) {
        if (attachment.type !== "image") {
          // We could also check mimeType if available, but 'type' field is what we store
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

    const senderInternalId =
      await this.userRepository.findInternalIdByPublicId(senderPublicId);
    if (!senderInternalId) {
      throw Errors.notFound("User");
    }
    let targetConversation = payload.conversationPublicId
      ? await this.conversationRepository.findByPublicId(
          payload.conversationPublicId,
          {
            populateParticipants: true,
          },
        )
      : null;

    if (!targetConversation && !payload.recipientPublicId) {
      throw Errors.validation("Recipient is required when no conversation is provided");
    }

    // Handle file upload
    let attachments = payload.attachments || [];
    if (file) {
      const convIdForPath = targetConversation
        ? targetConversation.publicId
        : "initial";
      const uploadPath = `${senderPublicId}/${convIdForPath}`;

      const { url } = await this.imageStorageService.uploadImageStream(
        { buffer: file.buffer, originalName: file.originalname, mimeType: file.mimetype },
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
          const recipientInternalId =
            await this.userRepository.findInternalIdByPublicId(
              payload.recipientPublicId!,
            );
          if (!recipientInternalId) {
            throw Errors.notFound("User");
          }

          const participantIds = [senderInternalId, recipientInternalId];
          const participantHash = this.buildParticipantHash(participantIds);

          conversationDoc =
            await this.conversationRepository.findByParticipantHash(
              participantHash,
            );

          if (!conversationDoc) {
            const participantObjectIds = participantIds.map(
              (id) => new mongoose.Types.ObjectId(id),
            );
            const unreadSeed = new Map<string, number>(
              participantIds.map((id) => [id, id === senderInternalId ? 0 : 1]),
            );

            conversationDoc = await this.conversationRepository.create(
              {
                participantHash,
                participants: participantObjectIds,
                lastMessageAt: new Date(),
                unreadCounts: unreadSeed,
              },
            );
          }
        } else {
          const existingParticipantIds = this.getParticipantIds(
            conversationDoc.participants,
          );
          if (!new Set(existingParticipantIds).has(senderInternalId)) {
            throw Errors.forbidden("You do not have access to this conversation");
          }
        }

        const participantIds: string[] = this.getParticipantIds(
          conversationDoc!.participants,
        );

        const recipientInternalIds: string[] = participantIds.filter(
          (id: string) => id !== senderInternalId,
        );

        const conversationId = toObjectId(conversationDoc!._id).toString();
        const message = await this.messageRepository.create(
          {
            conversation: new mongoose.Types.ObjectId(conversationId),
            sender: new mongoose.Types.ObjectId(senderInternalId),
            body: sanitizedBody,
            attachments:
              Array.isArray(attachments) && attachments.length > 0
                ? attachments.map((attachment) => ({ ...attachment }))
                : undefined,
            readBy: [new mongoose.Types.ObjectId(senderInternalId)],
            status: "sent",
          },
        );

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
        const populatedMessage = this.asPopulatedMessage(message);

        const participantObjectIds = participantIds.map(
          (participantId: string) => new mongoose.Types.ObjectId(participantId),
        );
        const alsSession = sessionALS.getStore() ?? null;
        const participantDocs = await this.userRepository
          .find({ _id: { $in: participantObjectIds } })
          .select("publicId")
          .session(alsSession)
          .lean<UserPublicIdLean[]>()
          .exec();

        const participantPublicIds = participantDocs.map((doc) => doc.publicId);

        // Create notifications only for recipients who are NOT currently viewing this conversation
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

        // only create notifications for users not actively viewing the conversation
        if (recipientsNeedingNotification.length > 0) {
          await Promise.all(
            recipientsNeedingNotification.map((recipientId) =>
              this.notificationService.createNotification({
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
      throw Errors.internal("Conversation context missing after message creation");
    }

    return this.dtoService.toPublicMessageDTO(
      messageDoc,
      targetConversation.publicId,
    );
  }

  async editMessage(
    userPublicId: string,
    messageId: string,
    newBody: string,
  ): Promise<MessageDTO> {
    const userInternalId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userInternalId) {
      throw Errors.notFound("User");
    }

    const message = await this.messageRepository.findByPublicId(messageId);
    if (!message) {
      throw Errors.notFound("Resource");
    }

    // IMessage.sender is statically typed as ObjectId, but at runtime it may be
    // a populated user object if .populate() was called on this query.
    // We use unknown here to allow the type guard to branch on the actual value.
    const sender: unknown = message.sender;
    if (this.isPopulatedSender(sender)) {
      if (sender.publicId !== undefined && sender.publicId !== userPublicId) {
        throw Errors.forbidden("You can only edit your own messages");
      }
      const senderId = sender._id ? sender._id.toString() : "";
      if (senderId && senderId !== userInternalId) {
        throw Errors.forbidden("You can only edit your own messages");
      }
    } else {
      if (message.sender.toString() !== userInternalId) {
        throw Errors.forbidden("You can only edit your own messages");
      }
    }

    const hasAttachments =
      message.attachments && message.attachments.length > 0;
    const allowEmpty = hasAttachments;

    let sanitizedBody: string;
    try {
      sanitizedBody = sanitizeTextInput(newBody, {
        maxLength: 5000,
        allowEmpty,
      });
    } catch (sanitizeError) {
      const errorMsg =
        sanitizeError instanceof Error ? sanitizeError.message : "Invalid message body";
      throw Errors.validation(errorMsg);
    }

    const updatedMessage = await this.messageRepository.updateMessage(
      messageId,
      { body: sanitizedBody },
    );
    if (!updatedMessage) {
      throw Errors.internal("Failed to update message");
    }

    const conversation = await this.conversationRepository.findById(
      updatedMessage.conversation.toString(),
    );
    if (!conversation) {
      throw Errors.internal("Conversation not found");
    }

    // Emit event for real-time update if needed (not implemented yet for edit, but good practice)
    // For now, just return updated message.

    return this.dtoService.toPublicMessageDTO(
      updatedMessage,
      conversation.publicId,
    );
  }

  async deleteMessage(userPublicId: string, messageId: string): Promise<void> {
    const userInternalId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userInternalId) {
      throw Errors.notFound("User");
    }

    const message = await this.messageRepository.findByPublicId(messageId);
    if (!message) {
      throw Errors.notFound("Resource");
    }

    // IMessage.sender is statically typed as ObjectId, but at runtime it may be
    // a populated user object. We use unknown to allow the type guard to branch.
    const senderRef: unknown = message.sender;
    const senderId = this.isPopulatedSender(senderRef)
      ? (senderRef._id ? senderRef._id.toString() : senderRef.publicId ?? "")
      : message.sender.toString();
    if (senderId !== userInternalId) {
      throw Errors.forbidden("You can only delete your own messages");
    }

    await this.unitOfWork.executeInTransaction(async () => {
      // Collect attachment publicIds to delete
      const attachmentPublicIds =
        message.attachments
          ?.map((att) => {
            const url = att.url;
            const cloudinaryMatch = url.match(
              /\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/,
            );
            if (cloudinaryMatch) return cloudinaryMatch[1];

            const localStorageMatch = url.match(/\/uploads\/(.+)$/);
            if (localStorageMatch) return localStorageMatch[1];

            logger.warn(
              "[MessagingService] Could not extract publicId from attachment URL, file may remain in storage",
              { url },
            );
            return null;
          })
          .filter((id): id is string => !!id) || [];

      await this.messageRepository.updateMessage(
        messageId,
        {
          body: "message deleted by user",
          attachments: [], // clear attachments from DB
        },
      );

      if (attachmentPublicIds.length > 0) {
        await this.eventBus.queueTransactional(
          new MessageAttachmentsDeletedEvent(attachmentPublicIds),
        );
      }
    });
  }

  private buildParticipantHash(participantIds: string[]): string {
    return participantIds
      .map((id) => id.toString())
      .sort()
      .join(":");
  }

  private mapConversationSummary(
    conversation: HydratedConversation,
    userInternalId: string,
  ): ConversationSummaryDTO {
    const unreadCounts = this.extractUnreadCounts(conversation.unreadCounts);
    const participants = Array.isArray(conversation.participants)
      ? conversation.participants
          .map((participant) => {
            // handle ObjectId case
            if (participant instanceof mongoose.Types.ObjectId) {
              return {
                publicId: "",
                handle: "",
                username: "",
                avatar: "",
              };
            }
            // handle populated participant case
            const populatedParticipant =
              participant as MaybePopulatedParticipant;
            return {
              publicId:
                populatedParticipant?.publicId ??
                this.extractParticipantId(participant) ??
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

  private extractUnreadCounts(
    unreadCounts:
      | Map<string, number>
      | Record<string, number>
      | null
      | undefined,
  ): Record<string, number> {
    if (!unreadCounts) {
      return {};
    }

    if (unreadCounts instanceof Map) {
      return Object.fromEntries(unreadCounts.entries());
    }

    return unreadCounts;
  }

  private async ensureConversationAccess(
    userPublicId: string,
    conversationPublicId: string,
  ) {
    const conversation = await this.conversationRepository.findByPublicId(
      conversationPublicId,
      {
        populateParticipants: true,
        includeLastMessage: true,
      },
    );

    if (!conversation) {
      throw Errors.notFound("Conversation");
    }

    const userInternalId =
      await this.userRepository.findInternalIdByPublicId(userPublicId);
    if (!userInternalId) {
      throw Errors.notFound("User");
    }

    const hasAccess = Array.isArray(conversation.participants)
      ? conversation.participants.some((participant) =>
          this.participantMatchesUser(participant, userInternalId),
        )
      : false;
    if (!hasAccess) {
      throw Errors.forbidden("You do not have access to this conversation");
    }

    return conversation;
  }

  private participantMatchesUser(
    participant:
      | MaybePopulatedParticipant
      | mongoose.Types.ObjectId
      | string
      | null,
    userInternalId: string,
  ): boolean {
    if (!participant) {
      return false;
    }

    if (typeof participant === "string") {
      return participant === userInternalId;
    }

    if (participant instanceof mongoose.Types.ObjectId) {
      return participant.toString() === userInternalId;
    }

    const candidateId = this.extractParticipantId(participant);
    return candidateId ? candidateId === userInternalId : false;
  }

  private extractParticipantId(
    participant:
      | MaybePopulatedParticipant
      | mongoose.Types.ObjectId
      | string
      | null,
  ): string | null {
    if (!participant) {
      return null;
    }

    if (participant instanceof mongoose.Types.ObjectId) {
      return participant.toString();
    }

    if (typeof participant === "string") {
      return participant;
    }

    if (typeof participant._id === "string") {
      return participant._id;
    }

    if (participant._id instanceof mongoose.Types.ObjectId) {
      return participant._id.toString();
    }

    if (typeof participant.id === "string") {
      return participant.id;
    }

    if (typeof participant.toString === "function") {
      return participant.toString();
    }

    return null;
  }

  private getParticipantIds(
    participants:
      | Array<MaybePopulatedParticipant | mongoose.Types.ObjectId | string>
      | null
      | undefined,
  ): string[] {
    if (!Array.isArray(participants)) {
      return [];
    }

    return participants
      .map((participant) => this.extractParticipantId(participant))
      .filter((id): id is string => Boolean(id));
  }

  /**
   * Casts a freshly `.populate()`-d IMessage to IMessageWithPopulatedSender.
   *
   * This cast is unavoidable because Mongoose's `.populate()` does not update
   * the return type. It is centralized here so the business logic that calls
   * `.populate()` never needs to inline an `as unknown as` assertion.
   *
   * Safe to call only after `message.populate("sender", "...")` has resolved.
   */
  private asPopulatedMessage(message: IMessage): IMessageWithPopulatedSender {
    return message as unknown as IMessageWithPopulatedSender;
  }

  /**
   * Type guard that narrows a message sender to a populated PopulatedSender
   * object rather than a plain ObjectId reference.
   *
   * Mongoose stores sender as ObjectId but populates it in place. After
   * `.populate()`, the field is an object with user fields. Before populate,
   * it is an ObjectId. This guard lets callers branch on the actual shape
   * without casting.
   */
  private isPopulatedSender(
    sender: mongoose.Types.ObjectId | PopulatedSender | unknown,
  ): sender is PopulatedSender {
    return (
      typeof sender === "object" &&
      sender !== null &&
      !("_bsontype" in sender) &&
      ("publicId" in sender || "handle" in sender || "username" in sender)
    );
  }
}
