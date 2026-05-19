import mongoose from "mongoose";
import { sessionALS } from "@/database/UnitOfWork";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { UserRepository } from "@/repositories/user.repository";
import { DTOService } from "@/services/dto.service";
import type {
  ConversationSummaryDTO,
  HydratedConversation,
  IMessage,
  MaybePopulatedParticipant,
  UserPublicIdLean,
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
  userRepository: UserRepository,
  userPublicId: UserPublicId,
): Promise<MongoId> {
  const userInternalId =
    await userRepository.findInternalIdByPublicId(userPublicId);
  if (!userInternalId) {
    throw Errors.notFound("User");
  }
  return userInternalId;
}

export async function ensureConversationAccess(
  conversationRepository: ConversationRepository,
  userRepository: UserRepository,
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
    userRepository,
    userPublicId,
  );
  const participantIds = getParticipantIds(conversation.participants);

  if (!new Set(participantIds).has(userInternalId)) {
    throw Errors.forbidden("You do not have access to this conversation");
  }

  return {
    conversation,
    userInternalId,
    participantIds,
  };
}

export async function resolveParticipantPublicIds(
  userRepository: UserRepository,
  participantIds: string[],
): Promise<UserPublicId[]> {
  const participantObjectIds = participantIds.map(
    (participantId) => new mongoose.Types.ObjectId(participantId),
  );
  const alsSession = sessionALS.getStore() ?? null;
  const participantDocs = await userRepository
    .find({ _id: { $in: participantObjectIds } })
    .select("publicId")
    .session(alsSession)
    .lean<UserPublicIdLean[]>()
    .exec();

  return participantDocs.map((doc) => doc.publicId).filter(Boolean);
}

export function mapConversationSummary(
  dtoService: DTOService,
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
    title: conversation.title,
  };
}

export function assertMessageOwnedByUser(
  message: IMessage,
  userPublicId: UserPublicId,
  userInternalId: string,
  failureMessage: string,
): void {
  const senderRef: unknown = message.sender;

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

  if (message.sender.toString() !== userInternalId) {
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
