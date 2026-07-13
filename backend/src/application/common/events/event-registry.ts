import type { ColdStartFeedGeneratedEvent } from "@/application/events/ColdStartFeedGenerated.event";
import type {
  ImageAssetCleanupRequestedEvent,
  ImageDeletedEvent,
  ImageUploadedEvent,
} from "@/application/events/image/image.event";
import type {
  MessageAttachmentsDeletedEvent,
  MessageSentEvent,
  MessageStatusUpdatedEvent,
} from "@/application/events/message/message.event";
import type { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import type {
  PostDeletedEvent,
  PostLikeCountReconciledEvent,
  PostUploadedEvent,
} from "@/application/events/post/post.event";
import type {
  UserAvatarChangedEvent,
  UserBannedEvent,
  UserCoverChangedEvent,
  UserDeletedEvent,
  UserInteractedWithPostEvent,
  UserUsernameChangedEvent,
} from "@/application/events/user/user-interaction.event";

export const EventRegistry = {
  domain: {
    ColdStartFeedGenerated: "ColdStartFeedGeneratedEvent",
    ImageAssetCleanupRequested: "ImageAssetCleanupRequestedEvent",
    ImageDeleted: "ImageDeletedEvent",
    ImageUploaded: "ImageUploadedEvent",
    MessageAttachmentsDeleted: "MessageAttachmentsDeletedEvent",
    MessageSent: "MessageSentEvent",
    MessageStatusUpdated: "MessageStatusUpdatedEvent",
    NotificationRequested: "NotificationRequestedEvent",
    PostDeleted: "PostDeletedEvent",
    PostLikeCountReconciled: "PostLikeCountReconciledEvent",
    PostUploaded: "PostUploadedEvent",
    UserAvatarChanged: "UserAvatarChangedEvent",
    UserBanned: "UserBannedEvent",
    UserCoverChanged: "UserCoverChangedEvent",
    UserDeleted: "UserDeletedEvent",
    UserInteractedWithPost: "UserInteractedWithPostEvent",
    UserUsernameChanged: "UserUsernameChangedEvent",
  },
  redisChannels: {
    feedUpdates: "feed_updates",
    messagingUpdates: "messaging_updates",
    notificationUpdates: "notification_updates",
    profileSnapshotUpdates: "profile_snapshot_updates",
  },
  socketClientEvents: {
    join: "join",
    conversationOpened: "conversation_opened",
    conversationClosed: "conversation_closed",
  },
  socketServerEvents: {
    joinResponse: "join_response",
    feedUpdate: "feed_update",
    likeUpdate: "like_update",
    avatarUpdate: "avatar_update",
    feedInteraction: "feed_interaction",
    messagingUpdate: "messaging_update",
    newNotification: "new_notification",
    notificationRead: "notification_read",
    allNotificationsRead: "all_notifications_read",
  },
  realtimeMessageTypes: {
    newImage: "new_image",
    newImageGlobal: "new_image_global",
    newPost: "new_post",
    newPostGlobal: "new_post_global",
    postDeleted: "post_deleted",
    interaction: "interaction",
    likeUpdate: "like_update",
    avatarChanged: "avatar_changed",
    messageSent: "message_sent",
    messageStatusUpdated: "message_status_updated",
    newNotification: "new_notification",
    userDeleted: "user_deleted",
    userBanned: "user_banned",
  },
  socketPayloadTypes: {
    likeCountChanged: "like_count_changed",
    postPublished: "post_published",
    userAvatarChanged: "user_avatar_changed",
    userDeleted: "user_deleted",
    userBanned: "user_banned",
    userInteraction: "user_interaction",
    usernameChanged: "username_changed",
  },
} as const;

export type DomainEventName =
  (typeof EventRegistry.domain)[keyof typeof EventRegistry.domain];
export type RedisChannelName =
  (typeof EventRegistry.redisChannels)[keyof typeof EventRegistry.redisChannels];
export type RealtimeMessageType =
  (typeof EventRegistry.realtimeMessageTypes)[keyof typeof EventRegistry.realtimeMessageTypes];
export type SocketServerEventName =
  (typeof EventRegistry.socketServerEvents)[keyof typeof EventRegistry.socketServerEvents];

export interface EventPayloadRegistry {
  ColdStartFeedGeneratedEvent: ColdStartFeedGeneratedEvent;
  ImageAssetCleanupRequestedEvent: ImageAssetCleanupRequestedEvent;
  ImageDeletedEvent: ImageDeletedEvent;
  ImageUploadedEvent: ImageUploadedEvent;
  MessageAttachmentsDeletedEvent: MessageAttachmentsDeletedEvent;
  MessageSentEvent: MessageSentEvent;
  MessageStatusUpdatedEvent: MessageStatusUpdatedEvent;
  NotificationRequestedEvent: NotificationRequestedEvent;
  PostDeletedEvent: PostDeletedEvent;
  PostLikeCountReconciledEvent: PostLikeCountReconciledEvent;
  PostUploadedEvent: PostUploadedEvent;
  UserAvatarChangedEvent: UserAvatarChangedEvent;
  UserBannedEvent: UserBannedEvent;
  UserCoverChangedEvent: UserCoverChangedEvent;
  UserDeletedEvent: UserDeletedEvent;
  UserInteractedWithPostEvent: UserInteractedWithPostEvent;
  UserUsernameChangedEvent: UserUsernameChangedEvent;
}

export type RegisteredEventType = keyof EventPayloadRegistry;

export function buildRealtimeEventId(
  ...parts: Array<string | number | boolean | null | undefined>
): string {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map(String)
    .join(":");
}
