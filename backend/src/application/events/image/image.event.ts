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
