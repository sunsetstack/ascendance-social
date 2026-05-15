import { UserPublicId } from "@/types/branded";
/**
 * @pattern Strategy
 *
 * Abstraction for image upload methods.
 * Each strategy encapsulates how image data reaches the storage provider.
 */
export interface IImageUploadStrategy {
  upload(
    userPublicId: UserPublicId,
  ): Promise<{ url: string; publicId: string }>;
}
