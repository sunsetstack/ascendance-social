import {
  IMessage,
  IMessageAttachment,
  IMessagePopulated,
  MessageDTO,
} from "@/types";
import { ConversationPublicId } from "@/types/branded";

export function toPublicMessageDTO(
  message: IMessage | IMessagePopulated,
  conversationPublicId: ConversationPublicId,
): MessageDTO {
  const populatedMessage = message as IMessagePopulated;
  const sender = populatedMessage.sender || {};

  const readBy = Array.isArray(populatedMessage.readBy)
    ? populatedMessage.readBy.map((entry) => {
        if (!entry) return "";
        if (typeof entry === "string") return entry;
        if (
          typeof entry === "object" &&
          "publicId" in entry &&
          entry.publicId
        ) {
          return entry.publicId;
        }
        if (typeof entry === "object" && typeof entry.toString === "function") {
          return entry.toString();
        }
        return String(entry);
      })
    : [];

  const attachments: IMessageAttachment[] = Array.isArray(message.attachments)
    ? message.attachments
    : [];

  const createdAtValue = message.createdAt;
  const createdAt =
    createdAtValue instanceof Date
      ? createdAtValue
      : new Date(createdAtValue);

  return {
    publicId: message.publicId,
    conversationId: conversationPublicId,
    body: message.body,
    sender: {
      publicId: sender?.publicId ?? "",
      handle: sender?.handle ?? "",
      username: sender?.username ?? "",
      avatar: sender?.avatar ?? "",
    },
    attachments,
    status: message.status,
    createdAt: createdAt.toISOString(),
    readBy: readBy.filter((value: string) => Boolean(value)),
  };
}
