import { PostPublicId, UserPublicId } from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { EventRegistry } from "@/application/common/events/event-registry";
import { randomUUID } from "node:crypto";

/**
 * Fired when a new post is created
 */
export class PostUploadedEvent implements IEvent {
  static readonly type = EventRegistry.domain.PostUploaded;
  readonly type = PostUploadedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly postId: PostPublicId,
    public readonly authorPublicId: UserPublicId,
    public readonly tags: string[],
  ) {}
}

/**
 * Fired when a post is deleted
 */
export class PostDeletedEvent implements IEvent {
  static readonly type = EventRegistry.domain.PostDeleted;
  readonly type = PostDeletedEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly postId: PostPublicId,
    public readonly authorPublicId: UserPublicId,
  ) {}
}

export class PostLikeCountReconciledEvent implements IEvent {
  static readonly type = EventRegistry.domain.PostLikeCountReconciled;
  readonly type = PostLikeCountReconciledEvent.type;
  readonly timestamp: Date = new Date();

  constructor(
    public readonly postId: PostPublicId,
    public readonly likesCount: number,
    public readonly eventId: string = randomUUID(),
  ) {}
}

export class PostUpdatedEvent implements IEvent {
  static readonly type = EventRegistry.domain.PostUpdated;
  readonly type = PostUpdatedEvent.type;
  readonly timestamp: Date = new Date();
  constructor(public readonly postId: PostPublicId, public readonly authorPublicId: UserPublicId) {}
}
