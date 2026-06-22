/**
 * TLDR: type-safety helper for the string based outbox/event replay path that EventBus.publishByType needed 
 * 
 * 
 * A TS type map for EventBus.publishByType
 * Maps event type strings to the event payload class or type 
 * Now publishByType can say: 
 * `  eventPayload: TEventType extends RegisteredEventType
    ? EventRegistry[TEventType]
    : unknown,
    ...
   `
  * Before this type map, EventBus.publishByType was allowing the paylor and string to drift apart silently:
   `eventBus.publishByType("PostUploadedEvent", { whatever: true });' 
   //TS doesn't complain because the method was: 
   publishByType(eventType: string, eventPayload: unknown)
   `
 * With the registry known event names get type-checked and if 
 * someone passes the wrong payload shape for a known event name, TypeScript can catch it


  
 */

import { ColdStartFeedGeneratedEvent } from "@/application/events/ColdStartFeedGenerated.event";
import {
  ImageAssetCleanupRequestedEvent,
  ImageDeletedEvent,
  ImageUploadedEvent,
} from "@/application/events/image/image.event";
import {
  MessageAttachmentsDeletedEvent,
  MessageSentEvent,
  MessageStatusUpdatedEvent,
} from "@/application/events/message/message.event";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import {
  PostDeletedEvent,
  PostUploadedEvent,
} from "@/application/events/post/post.event";
import {
  UserAvatarChangedEvent,
  UserCoverChangedEvent,
  UserDeletedEvent,
  UserInteractedWithPostEvent,
  UserUsernameChangedEvent,
} from "@/application/events/user/user-interaction.event";

export interface EventRegistry {
  ColdStartFeedGeneratedEvent: ColdStartFeedGeneratedEvent;
  ImageAssetCleanupRequestedEvent: ImageAssetCleanupRequestedEvent;
  ImageDeletedEvent: ImageDeletedEvent;
  ImageUploadedEvent: ImageUploadedEvent;
  MessageAttachmentsDeletedEvent: MessageAttachmentsDeletedEvent;
  MessageSentEvent: MessageSentEvent;
  MessageStatusUpdatedEvent: MessageStatusUpdatedEvent;
  NotificationRequestedEvent: NotificationRequestedEvent;
  PostDeletedEvent: PostDeletedEvent;
  PostUploadedEvent: PostUploadedEvent;
  UserAvatarChangedEvent: UserAvatarChangedEvent;
  UserCoverChangedEvent: UserCoverChangedEvent;
  UserDeletedEvent: UserDeletedEvent;
  UserInteractedWithPostEvent: UserInteractedWithPostEvent;
  UserUsernameChangedEvent: UserUsernameChangedEvent;
}

export type RegisteredEventType = keyof EventRegistry;
