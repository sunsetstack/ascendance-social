/**
 * @pattern Strategy
 *
 * Abstraction for image upload methods.
 * Each strategy encapsulates how image data reaches the storage provider.
 */
export interface IImageUploadStrategy {
  upload(userPublicId: string): Promise<{ url: string; publicId: string }>;
}
