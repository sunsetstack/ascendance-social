import type { IImageUploadStrategy } from "./IImageUploadStrategy";
import type { ImageService } from "@/services/image.service";

/**
 * @pattern Strategy (concrete)
 *
 * Uploads an image directly from an in-memory buffer using the streaming API.
 * Preferred over FilePathUploadStrategy — avoids intermediate disk I/O.
 */
export class BufferUploadStrategy implements IImageUploadStrategy {
  constructor(
    private readonly imageService: ImageService,
    private readonly buffer: Buffer,
    private readonly originalName?: string,
    private readonly mimeType?: string,
  ) {}

  async upload(userPublicId: string): Promise<{ url: string; publicId: string }> {
    return this.imageService.uploadImageStream(
      {
        buffer: this.buffer,
        originalName: this.originalName,
        mimeType: this.mimeType,
      },
      userPublicId,
    );
  }
}
