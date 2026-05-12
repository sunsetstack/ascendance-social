import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { IImageStorageService, ImageUploadInput } from "@/types";
import { injectable } from "tsyringe";
import { Errors, wrapError } from "@/utils/errors";
import { logger } from "@/utils/winston";

@injectable()
export class LocalStorageService implements IImageStorageService {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
    logger.info(
      "LocalStorageService: Uploads directory path inside container:",
      { uploadsDir: this.uploadsDir },
    );
  }

  /**
   * Convert a Buffer to a readable stream
   */
  private bufferToStream(buffer: Buffer): Readable {
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);
    return readable;
  }

  /**
   * Get file extension from MIME type or original name
   */
  private getExtension(mimeType?: string, originalName?: string): string {
    if (mimeType) {
      const mimeToExt: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
      };
      if (mimeToExt[mimeType]) return mimeToExt[mimeType];
    }
    if (originalName) {
      const ext = path.extname(originalName).toLowerCase();
      if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
        return ext === ".jpeg" ? ".jpg" : ext;
      }
    }
    return ".png"; // default
  }

  /**
   * Upload an image from a Buffer or Stream directly to local storage.
   * Uses stream pipeline for efficient memory usage.
   */
  async uploadImageStream(
    input: ImageUploadInput,
    userId: string,
    folder?: string,
  ): Promise<{ url: string; publicId: string }> {
    // If filePath is provided, fall back to legacy method
    if (input.filePath && !input.buffer && !input.stream) {
      return this.uploadImage(input.filePath, userId, folder);
    }

    try {
      const safeUserId = this.validateUserId(userId);
      const ext = this.getExtension(input.mimeType, input.originalName);
      const filename = `${uuidv4()}${ext}`;
      
      logger.info("UserID in local storage service:", { safeUserId });

      let userDir = this.safeJoin(this.uploadsDir, safeUserId);
      let urlPrefix = `/uploads/${safeUserId}`;
      let publicIdPrefix = safeUserId;

      if (folder) {
        const safeFolder = folder
          .split("/")
          .filter(Boolean)
          .map((s) => s.replace(/[^a-z0-9-]/gi, ""))
          .join("/");

        if (safeFolder) {
          userDir = this.safeJoin(this.uploadsDir, safeFolder);
          urlPrefix = `/uploads/${safeFolder}`;
          publicIdPrefix = safeFolder;
        }
      }

      const destFilepath = this.safeJoin(userDir, filename);

      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      // Get source stream
      let sourceStream: Readable;
      if (input.buffer) {
        sourceStream = this.bufferToStream(input.buffer);
      } else if (input.stream) {
        sourceStream = input.stream;
      } else {
        throw Errors.validation("No image data provided");
      }

      // Use stream pipeline for efficient writing
      const writeStream = fs.createWriteStream(destFilepath);
      await pipeline(sourceStream, writeStream);

      const url = `${urlPrefix}/${filename}`;
      return { url, publicId: `${publicIdPrefix}/${filename}` };
    } catch (error) {
      logger.error("Failed to upload image stream", { error });
      throw wrapError(error, "StorageError");
    }
  }

  /**
   * @deprecated Use uploadImageStream for better performance
   * Legacy method that copies from file path
   */
  async uploadImage(
    filePath: string,
    userId: string,
    folder?: string,
  ): Promise<{ url: string; publicId: string }> {
    try {
      const safeUserId = this.validateUserId(userId);

      const filename = `${uuidv4()}.png`;
      logger.info("UserID in local storage service:", { safeUserId });

      let userDir = this.safeJoin(this.uploadsDir, safeUserId);
      let urlPrefix = `/uploads/${safeUserId}`;
      let publicIdPrefix = safeUserId;

      if (folder) {
        // Sanitize folder to avoid traversal
        const safeFolder = folder
          .split("/")
          .filter(Boolean)
          .map((s) => {
            // only allow alphanumeric and hyphens for folder names
            return s.replace(/[^a-z0-9-]/gi, "");
          })
          .join("/");

        if (safeFolder) {
          userDir = this.safeJoin(this.uploadsDir, safeFolder);
          urlPrefix = `/uploads/${safeFolder}`;
          publicIdPrefix = safeFolder;
        }
      }

      const destFilepath = this.safeJoin(userDir, filename);

      if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
      }

      // Use stream pipeline instead of copyFile for better efficiency
      const readStream = fs.createReadStream(filePath);
      const writeStream = fs.createWriteStream(destFilepath);
      await pipeline(readStream, writeStream);

      const url = `${urlPrefix}/${filename}`;

      // Return composite publicId to enable O(1) deletion later
      return { url, publicId: `${publicIdPrefix}/${filename}` };
    } catch (error) {
      logger.error("Failed to upload image", { error });
      throw wrapError(error, "StorageError");
    }
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      // Try to parse composite publicId (userId/filename)
      const parts = publicId.split("/");
      if (parts.length === 2) {
        const [userId, filename] = parts;
        const safeUserId = this.validateUserId(userId);
        const safeFileName = this.validateFileName(filename);
        const filePath = this.safeJoin(
          this.uploadsDir,
          safeUserId,
          safeFileName,
        );

        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          return;
        }
      }

      // Fallback: If publicId is just a filename (legacy data), we must scan (slow)
      // This ensures backward compatibility but should be avoided for new uploads
      if (!publicId.includes("/")) {
        logger.warn("Performing slow O(N) scan for legacy image deletion", {
          publicId,
        });
        await this.deleteLegacyImage(publicId);
      }
    } catch (error) {
      logger.error("Error deleting asset", { error });
      throw wrapError(error, "StorageError");
    }
  }

  private async deleteLegacyImage(filename: string): Promise<void> {
    const safeFileName = this.validateFileName(filename);
    const userDirs = await fs.promises.readdir(this.uploadsDir);

    for (const userDir of userDirs) {
      try {
        const safeUserDir = this.validateUserId(userDir);
        const filePath = this.safeJoin(
          this.uploadsDir,
          safeUserDir,
          safeFileName,
        );

        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
          return;
        }
      } catch (err) {
        continue;
      }
    }
  }

  /**
   * Delete an asset by URL
   * Authorization must be handled by the calling handler/service BEFORE invoking this method
   * This service only handles file operations, not permission checks
   */
  async deleteAssetByUrl(
    _requesterPublicId: string,
    ownerPublicId: string,
    url: string,
  ): Promise<{ result: string }> {
    // parse & decode URL robustly
    const parsed = (() => {
      try {
        return new URL(url, "http://localhost");
      } catch {
        return null;
      }
    })();
    if (!parsed) throw Errors.storage("Invalid URL");
    const pathname = decodeURIComponent(parsed.pathname);

    const publicId = this.extractPublicId(pathname);
    if (!publicId)
      throw Errors.storage("Could not extract publicId from URL");

    // validate filename and ownerPublicId
    const safeFileName = this.validateFileName(publicId);
    const safeOwner = this.validateUserId(ownerPublicId);

    const assetPath = this.safeJoin(this.uploadsDir, safeOwner, safeFileName);

    // lstat + symlink/file check
    const stat = await fs.promises.lstat(assetPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return { result: "skipped" };
    }
    if (stat.isSymbolicLink()) {
      throw Errors.storage("Refusing to remove symlink");
    }

    await fs.promises.unlink(assetPath);
    return { result: "ok" };
  }

  async deleteMany(
    username: string,
  ): Promise<{ result: "ok" | "error"; message?: string }> {
    try {
      // validate username is a proper UUID v4
      const safeUsername = this.validateUserId(username);

      // safely join paths with traversal protection
      const userDir = this.safeJoin(this.uploadsDir, safeUsername);

      if (!fs.existsSync(userDir)) {
        return {
          result: "ok",
          message: "User folder does not exist, nothing to delete.",
        };
      }

      const files = await fs.promises.readdir(userDir);
      if (files.length === 0) {
        return { result: "ok", message: "User folder is already empty." };
      }

      // only delete files that match the expected format
      await Promise.all(
        files.map(async (file) => {
          try {
            // validate each file is a proper image file
            const safeFileName = this.validateFileName(file);
            const filePath = this.safeJoin(userDir, safeFileName);
            await fs.promises.unlink(filePath);
          } catch (err) {
            // skip files that don't match expected format
            logger.warn(`Skipping invalid file: ${file}`, { error: err });
          }
        }),
      );

      // remove directory if empty
      const remainingFiles = await fs.promises.readdir(userDir);
      if (remainingFiles.length === 0) {
        await fs.promises.rmdir(userDir);
      }

      return {
        result: "ok",
        message: `Successfully deleted all images for user: ${safeUsername}`,
      };
    } catch (error) {
      logger.error("Error deleting multiple assets:", { error });
      return {
        result: "error",
        message:
          error instanceof Error
            ? error.message
            : "Error deleting local storage resources",
      };
    }
  }

  /* Methods to validate inputs in order to prevent directory traversal attacks */
  private validateUserId(userId: string): string {
    // remove null bytes and trim
    const cleaned = String(userId).replace(/\0/g, "").trim();

    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidV4Regex.test(cleaned)) {
      throw Errors.validation("Invalid user identifier format");
    }

    return cleaned;
  }

  private validateFileName(fileName: string): string {
    // remove null bytes and use basename to prevent directory traversal
    const cleaned = path.basename(String(fileName).replace(/\0/g, "").trim());

    // expected format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx.png
    const fileNameRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|jpeg|webp)$/i;

    if (!fileNameRegex.test(cleaned)) {
      throw Errors.validation("Invalid file name format");
    }

    return cleaned;
  }

  // safe path join that prevents directory traversal
  private safeJoin(base: string, ...segments: string[]): string {
    const resolvedBase = path.resolve(base);
    const resolvedPath = path.resolve(resolvedBase, ...segments);
    const relativePath = path.relative(resolvedBase, resolvedPath);

    // check if resolved path escapes base directory
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw Errors.validation("Path traversal attempt detected");
    }

    return resolvedPath;
  }

  private extractPublicId(url: string): string | null {
    try {
      // if url is absolute, parse; if relative, prepend origin so URL works
      const parsed = new URL(url, "http://localhost");
      const pathname = decodeURIComponent(parsed.pathname);
      const match = pathname.match(/\/uploads\/[^\/]+\/([^\/]+)$/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}
