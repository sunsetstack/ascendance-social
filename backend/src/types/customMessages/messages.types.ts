import mongoose, { Document } from "mongoose";
import {
  ConversationPublicId,
  MessagePublicId,
  UserPublicId,
} from "@/types/branded";

export type MessageStatus = "sent" | "delivered" | "read";

export interface IMessageAttachment {
  url: string;
  type: string;
  mimeType?: string;
  thumbnailUrl?: string;
}

export interface IMessage extends Document {
  publicId: MessagePublicId;
  conversation: mongoose.Types.ObjectId;
  sender: mongoose.Types.ObjectId;
  body: string;
  attachments?: IMessageAttachment[];
  status: MessageStatus;
  readBy: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversation extends Document {
  _id: mongoose.Types.ObjectId;
  publicId: ConversationPublicId;
  participantHash: string;
  participants: mongoose.Types.ObjectId[];
  lastMessage?: mongoose.Types.ObjectId;
  lastMessageAt?: Date;
  unreadCounts: Map<string, number>;
  isGroup: boolean;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessageCreateInput {
  conversationId: string;
  senderId: string;
  body: string;
  attachments?: IMessageAttachment[];
}

export interface SendMessagePayload {
  conversationPublicId?: ConversationPublicId;
  recipientPublicId?: UserPublicId;
  body: string;
  attachments?: IMessageAttachment[];
}

export interface MessageDTO {
  publicId: string;
  conversationId: string;
  body: string;
  sender: {
    publicId: string;
    handle: string;
    username: string;
    avatar: string;
  };
  attachments: IMessageAttachment[];
  status: MessageStatus;
  createdAt: string;
  readBy: string[];
}

export interface ConversationParticipantDTO {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
}

export interface ConversationSummaryDTO {
  publicId: string;
  participants: ConversationParticipantDTO[];
  lastMessage?: MessageDTO | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  isGroup: boolean;
  title?: string;
}

export interface PaginatedConversationSummaryResult {
  conversations: ConversationSummaryDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedMessageResult {
  messages: MessageDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PopulatedSender {
  _id?: mongoose.Types.ObjectId;
  publicId?: UserPublicId;
  handle?: string;
  username?: string;
  avatar?: string;
}

// message where sender is populated
export interface IMessagePopulated extends Omit<IMessage, "sender" | "readBy"> {
  sender?: PopulatedSender;
  readBy?: Array<
    | string
    | mongoose.Types.ObjectId
    | { publicId?: UserPublicId; toString?: () => string }
  >;
}

export interface IMessageWithPopulatedSender extends Omit<IMessage, "sender"> {
  sender: PopulatedSender;
}

export interface MaybePopulatedParticipant {
  _id?: mongoose.Types.ObjectId | string;
  id?: string;
  publicId?: UserPublicId;
  handle?: string;
  username?: string;
  avatar?: string;
  toString?: () => string;
}

// hydrated conversation with populated participants and last message
// participants can be ObjectId[] or populated user objects
export interface HydratedConversation {
  publicId: ConversationPublicId;
  participants: Array<mongoose.Types.ObjectId | MaybePopulatedParticipant>;
  lastMessage?: IMessage | null;
  lastMessageAt?: Date;
  unreadCounts: Map<string, number> | Record<string, number>;
  isGroup: boolean;
  title?: string;
  _id: mongoose.Types.ObjectId;
  updatedAt: Date;
}

export interface UserPublicIdLean {
  publicId: UserPublicId;
}
