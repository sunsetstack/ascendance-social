import type { IImageUploadStrategy } from "./IImageUploadStrategy";
import type { ImageService } from "@/services/image.service";

/**
 * @pattern Strategy (concrete)
 *
 * Uploads an image from a file path on disk.
 * @deprecated Exists only for backward compatibility with diskStorage.
 *   Prefer BufferUploadStrategy with memoryStorage.
 */
export class FilePathUploadStrategy implements IImageUploadStrategy {
  constructor(
    private readonly imageService: ImageService,
    private readonly filePath: string,
  ) {}

  async upload(userPublicId: string): Promise<{ url: string; publicId: string }> {
    return this.imageService.uploadImage(this.filePath, userPublicId);
  }
}
