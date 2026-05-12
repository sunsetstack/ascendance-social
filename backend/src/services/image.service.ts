import mongoose from "mongoose";
import { inject, injectable } from "tsyringe";
import { ImageRepository } from "@/repositories/image.repository";
import type {
  AttachmentCreationResult,
  CreatePostAttachmentInput,
  DeleteAttachmentAssetInput,
  IImage,
  IImageStorageService,
  ImageDocWithId,
  ImageUploadInput,
  PopulatedUserField,
  RemoveAttachmentRecordInput,
  RemoveAttachmentRecordResult,
  RemoveAttachmentInput,
  RemoveAttachmentResult,
} from "@/types";
import { AppError, wrapError } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { generateSlug } from "@/utils/helpers";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ImageService {
  constructor(
    @inject(TOKENS.Repositories.Image)
    private readonly imageRepository: ImageRepository,
    @inject(TOKENS.Services.ImageStorage)
    private readonly imageStorageService: IImageStorageService,
  ) {}

  async createPostAttachment(
    input: CreatePostAttachmentInput,
  ): Promise<AttachmentCreationResult> {
    let uploaded: { url: string; publicId: string } | undefined;
    try {
      uploaded = await this.imageStorageService.uploadImage(
        input.filePath,
        input.userPublicId,
      );
      return await this.createImageRecord({
        url: uploaded.url,
        storagePublicId: uploaded.publicId,
        originalName: input.originalName,
        userInternalId: input.userInternalId,
      });
    } catch (error) {
      if (uploaded) {
        await this.rollbackUpload(uploaded.publicId);
      }
      throw this.buildContextError(error, "createPostAttachment");
    }
  }

  /**
   * @deprecated Use uploadImageStream for better performance
   */
  async uploadImage(
    filePath: string,
    userPublicId: string,
  ): Promise<{ url: string; publicId: string }> {
    return this.imageStorageService.uploadImage(filePath, userPublicId);
  }

  /**
   * Upload an image from a Buffer or Stream directly.
   * This is more efficient as it avoids intermediate disk I/O.
   */
  async uploadImageStream(
    input: ImageUploadInput,
    userPublicId: string,
  ): Promise<{ url: string; publicId: string }> {
    return this.imageStorageService.uploadImageStream(input, userPublicId);
  }

  async createImageRecord(input: {
    url: string;
    storagePublicId: string;
    originalName: string;
    userInternalId: string;
  }): Promise<AttachmentCreationResult> {
    try {
      const slug = `${generateSlug(input.originalName) || "image"}-${Date.now()}`;
      const createdAt = new Date();

      const imageDoc = (await this.imageRepository.create(
        {
          url: input.url,
          publicId: input.storagePublicId,
          originalName: input.originalName,
          slug,
          user: new mongoose.Types.ObjectId(input.userInternalId),
          createdAt,
        } as unknown as IImage,
      )) as ImageDocWithId;

      return {
        imageDoc,
        storagePublicId: input.storagePublicId,
        summary: {
          docId: new mongoose.Types.ObjectId(imageDoc._id),
          publicId: imageDoc.publicId,
          url: imageDoc.url,
          slug: imageDoc.slug,
        },
      };
    } catch (error) {
      throw this.buildContextError(error, "createImageRecord");
    }
  }

  async rollbackUpload(publicId: string | null | undefined): Promise<void> {
    if (!publicId) return;
    try {
      await this.imageStorageService.deleteImage(publicId);
    } catch (error) {
      logger.error("Failed to rollback image upload", { error });
    }
  }

  async removePostAttachment(
    input: RemoveAttachmentInput,
  ): Promise<RemoveAttachmentResult> {
    try {
      const imageDoc = (await this.imageRepository.findById(
        input.imageId,
      )) as ImageDocWithId | null;
      if (!imageDoc) {
        return { removed: false };
      }

      const owningPublicId =
        this.resolveOwnerPublicId(imageDoc, input.ownerPublicId) ??
        input.requesterPublicId;

      await this.imageStorageService
        .deleteAssetByUrl(input.requesterPublicId, owningPublicId, imageDoc.url)
        .catch((error) =>
          logger.error("Failed to delete attachment asset", { error }),
        );

      await this.imageRepository.delete(imageDoc._id.toString());

      return {
        removed: true,
        removedPublicId: imageDoc.publicId,
        removedUrl: imageDoc.url,
      };
    } catch (error) {
      throw this.buildContextError(error, "removePostAttachment");
    }
  }

  async removePostAttachmentRecord(
    input: RemoveAttachmentRecordInput,
  ): Promise<RemoveAttachmentRecordResult> {
    try {
      const imageDoc = (await this.imageRepository.findById(
        input.imageId,
      )) as ImageDocWithId | null;
      if (!imageDoc) {
        return { removed: false };
      }

      await this.imageRepository.delete(imageDoc._id.toString());

      return {
        removed: true,
        removedPublicId: imageDoc.publicId,
        removedUrl: imageDoc.url,
      };
    } catch (error) {
      throw this.buildContextError(error, "removePostAttachmentRecord");
    }
  }

  async deleteAttachmentAsset(
    input: DeleteAttachmentAssetInput,
  ): Promise<void> {
    await this.imageStorageService.deleteAssetByUrl(
      input.requesterPublicId,
      input.ownerPublicId,
      input.url,
    );
  }

  private resolveOwnerPublicId(
    imageDoc: IImage,
    fallback?: string,
  ): string | undefined {
    if (fallback) {
      return fallback;
    }

    const userField = imageDoc.user;
    if (userField && typeof userField === "object" && "publicId" in userField) {
      return (userField as PopulatedUserField).publicId;
    }

    return undefined;
  }

  private buildContextError(error: unknown, context: string): AppError {
    return wrapError(error, "InternalServerError", {
      context: { operation: context, file: "image.service.ts" },
    });
  }
}
