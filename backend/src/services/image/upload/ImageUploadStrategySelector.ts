import type { IImageUploadStrategy } from "./IImageUploadStrategy";
import type { ImageService } from "@/services/image.service";
import { BufferUploadStrategy } from "./BufferUploadStrategy";
import { FilePathUploadStrategy } from "./FilePathUploadStrategy";

interface UploadCommandFields {
  imageBuffer?: Buffer;
  imagePath?: string;
  imageOriginalName?: string;
  imageMimeType?: string;
}

/**
 * @pattern Strategy (selector / simple factory)
 *
 * Returns the appropriate upload strategy based on the command fields,
 * or `null` when there is no image to upload.
 * The caller decides what to do with `null` — keeping null handling
 * explicit rather than hidden in a no-op class.
 */
export class ImageUploadStrategySelector {
  static from(
    command: UploadCommandFields,
    imageService: ImageService,
  ): IImageUploadStrategy | null {
    if (command.imageBuffer) {
      return new BufferUploadStrategy(
        imageService,
        command.imageBuffer,
        command.imageOriginalName,
        command.imageMimeType,
      );
    }

    if (command.imagePath) {
      return new FilePathUploadStrategy(imageService, command.imagePath);
    }

    return null;
  }
}
