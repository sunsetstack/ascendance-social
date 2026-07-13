import { UserPublicId, PostPublicId, MongoId } from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { EventRegistry } from "@/application/common/events/event-registry";

export class UserInteractedWithPostEvent implements IEvent {
  readonly type = EventRegistry.domain.UserInteractedWithPost;
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
  ) {}
}

export class UserAvatarChangedEvent implements IEvent {
  readonly type = EventRegistry.domain.UserAvatarChanged;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly oldAvatarUrl?: string,
    public readonly newAvatarUrl?: string,
  ) {}
}

export class UserUsernameChangedEvent implements IEvent {
  readonly type = EventRegistry.domain.UserUsernameChanged;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly oldUsername: string,
    public readonly newUsername: string,
  ) {}
}

export class UserCoverChangedEvent implements IEvent {
  readonly type = EventRegistry.domain.UserCoverChanged;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly oldCoverUrl?: string,
    public readonly newCoverUrl?: string,
  ) {}
}

export class UserDeletedEvent implements IEvent {
  readonly type = EventRegistry.domain.UserDeleted;
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
  readonly type = EventRegistry.domain.UserBanned;
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
