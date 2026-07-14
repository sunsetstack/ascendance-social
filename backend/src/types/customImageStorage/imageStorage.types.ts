import { UserPublicId } from "@/types/branded";
import { Readable } from "stream";

/**
 * Input for streaming image uploads.
 * Supports both file paths (legacy) and direct buffer/stream uploads.
 */
export interface ImageUploadInput {
  /** The image data as a Buffer (from memory storage) */
  buffer?: Buffer;
  /** The image data as a readable stream */
  stream?: Readable;
  /** File path on disk (legacy support) */
  filePath?: string;
  /** Original filename for generating unique names */
  originalName?: string;
  /** MIME type of the image */
  mimeType?: string;
}

export interface ImageUploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
}

export interface IImageStorageService {
  /**
   * Upload an image from a file path (legacy method).
   * @deprecated Use uploadImageStream for better performance
   */
  uploadImage(
    filePath: string,
    userId: string,
    folder?: string,
  ): Promise<ImageUploadResult>;

  /**
   * Upload an image from a Buffer or Stream directly.
   * This is more efficient as it avoids intermediate disk writes.
   */
  uploadImageStream(
    input: ImageUploadInput,
    userId: string,
    folder?: string,
  ): Promise<ImageUploadResult>;

  deleteImage(publicId: string): Promise<void>;
  deleteAssetByUrl(
    requesterPublicId: string,
    ownerPublicId: UserPublicId,
    url: string,
  ): Promise<{ result: string }>;
  deleteMany(userId: string): Promise<{
    result: "ok" | "error";
    message?: string;
  }>;
}
