import { UserPublicId, PostPublicId, MongoId } from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { EventRegistry } from "@/application/common/events/event-registry";
import { randomUUID } from "node:crypto";

export class UserInteractedWithPostEvent implements IEvent {
  static readonly type = EventRegistry.domain.UserInteractedWithPost;
  readonly type = UserInteractedWithPostEvent.type;
  readonly eventId: string = randomUUID();
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userId: UserPublicId,
    public readonly interactionType:
      | "like"
      | "unlike"
      | "comment"
      | "comment_deleted",
    public readonly postId: PostPublicId,
    public readonly tags: string[],
    public readonly postOwnerId: UserPublicId,
    public readonly activityId?: string,
  ) {}
}

export class UserAvatarChangedEvent implements IEvent {
  static readonly type = EventRegistry.domain.UserAvatarChanged;
  readonly type = UserAvatarChangedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly oldAvatarUrl?: string,
    public readonly newAvatarUrl?: string,
  ) {}
}

export class UserUsernameChangedEvent implements IEvent {
  static readonly type = EventRegistry.domain.UserUsernameChanged;
  readonly type = UserUsernameChangedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly oldUsername: string,
    public readonly newUsername: string,
  ) {}
}

export class UserCoverChangedEvent implements IEvent {
  static readonly type = EventRegistry.domain.UserCoverChanged;
  readonly type = UserCoverChangedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly oldCoverUrl?: string,
    public readonly newCoverUrl?: string,
  ) {}
}

export class UserDeletedEvent implements IEvent {
  static readonly type = EventRegistry.domain.UserDeleted;
  readonly type = UserDeletedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly userId: MongoId,
    public readonly followerPublicIds: UserPublicId[],
    public readonly affectedRelationshipPublicIds: UserPublicId[] =
      followerPublicIds,
    public readonly deletedPostPublicIds: PostPublicId[] = [],
  ) {}
}

export class UserBannedEvent implements IEvent {
  static readonly type = EventRegistry.domain.UserBanned;
  readonly type = UserBannedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly userId: MongoId,
    public readonly followerPublicIds: UserPublicId[],
    public readonly affectedRelationshipPublicIds: UserPublicId[] =
      followerPublicIds,
    public readonly deletedPostPublicIds: PostPublicId[] = [],
  ) {}
}
