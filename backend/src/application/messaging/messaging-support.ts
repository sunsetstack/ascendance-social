import mongoose from "mongoose";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { DTOService } from "@/services/dto.service";
import type {
  ConversationSummaryDTO,
  ConversationParticipantDTO,
  HydratedConversation,
  IMessage,
  MaybePopulatedParticipant,
} from "@/types";
import {
  ConversationPublicId,
  MessagePublicId,
  MongoId,
  UserPublicId,
} from "@/types/branded";
import { Errors } from "@/utils/errors";
import {
  extractParticipantId,
  extractUnreadCounts,
  getParticipantIds,
  isPopulatedSender,
} from "@/utils/messaging-helpers";

export interface ConversationAccessResult {
  conversation: NonNullable<
    Awaited<ReturnType<ConversationRepository["findByPublicId"]>>
  >;
  userInternalId: MongoId;
  participantIds: string[];
}

export async function requireUserInternalId(
  userReadRepository: Pick<IUserReadRepository, "findInternalIdByPublicId">,
  userPublicId: UserPublicId,
): Promise<MongoId> {
  const userInternalId =
    await userReadRepository.findInternalIdByPublicId(userPublicId);
  if (!userInternalId) {
    throw Errors.notFound("User");
  }
  return userInternalId;
}

export async function ensureConversationAccess(
  conversationRepository: ConversationRepository,
  userReadRepository: Pick<IUserReadRepository, "findInternalIdByPublicId">,
  userPublicId: UserPublicId,
  conversationPublicId: ConversationPublicId,
): Promise<ConversationAccessResult> {
  const conversation = await conversationRepository.findByPublicId(
    conversationPublicId,
    { populateParticipants: true },
  );

  if (!conversation) {
    throw Errors.notFound("Conversation");
  }

  const userInternalId = await requireUserInternalId(
    userReadRepository,
    userPublicId,
  );
  const participantIds = getParticipantIds(conversation.participants);

  if (!new Set(participantIds).has(userInternalId)) {
    throw Errors.forbidden("You do not have access to this conversation");
  }

  if (conversation.hiddenFor?.some((id) => id.toString() === userInternalId)) {
    throw Errors.notFound("Conversation");
  }

  return {
    conversation,
    userInternalId,
    participantIds,
  };
}

export async function resolveParticipantPublicIds(
  userReadRepository: Pick<IUserReadRepository, "findById">,
  participantIds: string[],
): Promise<UserPublicId[]> {
  const publicIds: UserPublicId[] = [];
  for (const participantId of participantIds) {
    const user = await userReadRepository.findById(participantId as MongoId);
    if (user?.publicId) publicIds.push(user.publicId);
  }
  return publicIds;
}

export function mapConversationSummary(
  dtoService: DTOService,
  conversation: HydratedConversation,
  userInternalId: string,
): ConversationSummaryDTO {
  const unreadCounts = extractUnreadCounts(conversation.unreadCounts);
  const participants: ConversationParticipantDTO[] = Array.isArray(
    conversation.participants,
  )
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

  for (const departed of conversation.departedParticipants ?? []) {
    participants.push({
      publicId: departed.publicId,
      handle: departed.handle,
      username: departed.username,
      avatar: departed.avatar,
      isUnavailable: true,
      unavailableReason: departed.reason,
    });
  }

  const clearedAt = getConversationClearedAt(conversation, userInternalId);
  const hasLastMessage =
    conversation.lastMessage &&
    (!clearedAt || conversation.lastMessage.createdAt > clearedAt) &&
    (conversation.lastMessage.publicId || conversation.lastMessage._id);
  const lastMessage =
    hasLastMessage && conversation.lastMessage
      ? dtoService.toPublicMessageDTO(
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
    isClosed: Boolean(conversation.isClosed),
    isLocked: Boolean(conversation.isLocked),
    closedReason: conversation.closedReason,
    title: conversation.title,
  };
}

export function getConversationClearedAt(
  conversation: Pick<HydratedConversation, "clearedAt">,
  userInternalId: string,
): Date | undefined {
  const value = conversation.clearedAt instanceof Map
    ? conversation.clearedAt.get(userInternalId)
    : conversation.clearedAt?.[userInternalId];
  return value ? new Date(value) : undefined;
}

export function assertMessageOwnedByUser(
  message: IMessage,
  userPublicId: UserPublicId,
  userInternalId: string,
  failureMessage: string,
): void {
  const senderRef: unknown = message.sender;

  if (!senderRef) {
    throw Errors.forbidden(failureMessage);
  }

  if (isPopulatedSender(senderRef)) {
    if (
      senderRef.publicId !== undefined &&
      senderRef.publicId !== userPublicId
    ) {
      throw Errors.forbidden(failureMessage);
    }

    if (senderRef._id && senderRef._id.toString() !== userInternalId) {
      throw Errors.forbidden(failureMessage);
    }

    return;
  }

  if (senderRef.toString() !== userInternalId) {
    throw Errors.forbidden(failureMessage);
  }
}

export async function requireMessage(
  messageRepository: MessageRepository,
  messagePublicId: MessagePublicId,
): Promise<IMessage> {
  const message = await messageRepository.findByPublicId(messagePublicId);
  if (!message) {
    throw Errors.notFound("Message");
  }
  return message;
}

export async function requireWritableMessageConversation(
  conversations: ConversationRepository,
  message: IMessage,
  userInternalId: string,
): Promise<ConversationAccessResult["conversation"]> {
  const existing = await conversations.findById(message.conversation.toString() as MongoId);
  if (!existing) throw Errors.notFound("Conversation");
  const conversation = await conversations.acquireForMutation(existing.publicId);
  const clearedAt = getConversationClearedAt(conversation, userInternalId);
  if (!getParticipantIds(conversation.participants).includes(userInternalId) ||
      conversation.hiddenFor?.some((id) => id.toString() === userInternalId) ||
      (clearedAt && message.createdAt <= clearedAt)) {
    throw Errors.notFound("Message");
  }
  if (conversation.isLocked) throw Errors.forbidden("Conversation locked by admin");
  return conversation;
}
