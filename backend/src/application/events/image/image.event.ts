import { ImagePublicId, UserPublicId } from "@/types/branded";
import { IEvent } from "@/application/common/interfaces/event.interface";

/**
 * Fired when a new image is uploaded
 * This is separate from interaction events because it affects different users
 */
export class ImageUploadedEvent implements IEvent {
  readonly type = "ImageUploadedEvent";
  readonly timestamp: Date = new Date();

  constructor(
    public readonly imageId: ImagePublicId,
    public readonly uploaderPublicId: UserPublicId,
    public readonly tags: string[],
  ) {}
}

/**
 * Fired when an image is deleted
 */
export class ImageDeletedEvent implements IEvent {
  readonly type = "ImageDeletedEvent";
  readonly timestamp: Date = new Date();

  constructor(
    public readonly imageId: ImagePublicId,
    public readonly uploaderPublicId: UserPublicId,
  ) {}
}

/**
 * Durable compensation request for storage assets that cannot be covered by
 * the MongoDB transaction boundary.
 */
export class ImageAssetCleanupRequestedEvent implements IEvent {
  readonly type = "ImageAssetCleanupRequestedEvent";
  readonly timestamp: Date = new Date();

  constructor(
    public readonly reason: string,
    public readonly storagePublicId?: string,
    public readonly url?: string,
    public readonly requesterPublicId?: UserPublicId,
    public readonly ownerPublicId?: UserPublicId,
  ) {}
}
