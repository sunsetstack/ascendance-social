import { UserPublicId } from "@/types/branded";
import type { ImageUploadResult } from "@/types";
/**
 * @pattern Strategy
 *
 * Abstraction for image upload methods.
 * Each strategy encapsulates how image data reaches the storage provider.
 */
export interface IImageUploadStrategy {
  upload(
    userPublicId: UserPublicId,
  ): Promise<ImageUploadResult>;
}
