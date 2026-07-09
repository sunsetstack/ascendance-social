import {
  ConversationPublicId,
  MessagePublicId,
  UserPublicId,
} from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { EventRegistry } from "@/application/common/events/event-registry";

export class MessageSentEvent implements IEvent {
  public readonly type = EventRegistry.domain.MessageSent;
  public readonly timestamp = new Date();

  constructor(
    public readonly conversationPublicId: ConversationPublicId,
    public readonly senderPublicId: UserPublicId,
    public readonly recipientPublicIds: UserPublicId[],
    public readonly messagePublicId: MessagePublicId,
    public readonly notification?: {
      actorUsername?: string;
      actorHandle?: string;
      actorAvatar?: string;
      targetPreview?: string;
    },
  ) {}
}

export class MessageStatusUpdatedEvent implements IEvent {
  public readonly type = EventRegistry.domain.MessageStatusUpdated;
  public readonly timestamp = new Date();

  constructor(
    public readonly conversationPublicId: ConversationPublicId,
    public readonly participantPublicIds: UserPublicId[],
    public readonly status: "delivered" | "read",
  ) {}
}

export class MessageAttachmentsDeletedEvent implements IEvent {
  public readonly type = EventRegistry.domain.MessageAttachmentsDeleted;
  public readonly timestamp = new Date();

  constructor(public readonly attachmentPublicIds: string[]) {}
}
