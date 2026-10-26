import {
  ConversationPublicId,
  MessagePublicId,
  UserPublicId,
} from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { EventRegistry } from "@/application/common/events/event-registry";
import { randomUUID } from "node:crypto";

export class ConversationsChangedEvent implements IEvent {
  static readonly type = EventRegistry.domain.ConversationsChanged;
  public readonly type = ConversationsChangedEvent.type;
  public readonly timestamp = new Date();
  public readonly eventId = randomUUID();

  constructor(
    public readonly participantPublicIds: UserPublicId[],
    public readonly notificationIds: string[] = [],
    public readonly requestLogIds: string[] = [],
  ) {}
}

export class MessageSentEvent implements IEvent {
  static readonly type = EventRegistry.domain.MessageSent;
  public readonly type = MessageSentEvent.type;
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
  static readonly type = EventRegistry.domain.MessageStatusUpdated;
  public readonly type = MessageStatusUpdatedEvent.type;
  public readonly timestamp = new Date();

  constructor(
    public readonly conversationPublicId: ConversationPublicId,
    public readonly participantPublicIds: UserPublicId[],
    public readonly status: "delivered" | "read",
  ) {}
}

export class MessageAttachmentsDeletedEvent implements IEvent {
  static readonly type = EventRegistry.domain.MessageAttachmentsDeleted;
  public readonly type = MessageAttachmentsDeletedEvent.type;
  public readonly timestamp = new Date();

  constructor(public readonly attachmentPublicIds: string[]) {}
}
