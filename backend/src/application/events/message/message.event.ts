import {
  ConversationPublicId,
  MessagePublicId,
  UserPublicId,
} from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";

export class MessageSentEvent implements IEvent {
  public readonly type = "MessageSentEvent";
  public readonly timestamp = new Date();

  constructor(
    public readonly conversationPublicId: ConversationPublicId,
    public readonly senderPublicId: UserPublicId,
    public readonly recipientPublicIds: UserPublicId[],
    public readonly messagePublicId: MessagePublicId,
  ) {}
}

export class MessageStatusUpdatedEvent implements IEvent {
  public readonly type = "MessageStatusUpdatedEvent";
  public readonly timestamp = new Date();

  constructor(
    public readonly conversationPublicId: ConversationPublicId,
    public readonly participantPublicIds: UserPublicId[],
    public readonly status: "delivered" | "read",
  ) {}
}

export class MessageAttachmentsDeletedEvent implements IEvent {
  public readonly type = "MessageAttachmentsDeletedEvent";
  public readonly timestamp = new Date();

  constructor(public readonly attachmentPublicIds: string[]) {}
}
