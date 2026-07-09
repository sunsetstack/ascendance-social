import multer from "multer";
import { Request, RequestHandler } from "express";
import { Errors } from "@/utils/errors";

type AllowedImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const allowedMimeTypes: AllowedImageMimeType[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const mimeAliases: Record<string, AllowedImageMimeType> = {
  "image/jpg": "image/jpeg",
};

const normalizeMimeType = (mimeType: string): string =>
  mimeAliases[mimeType] ?? mimeType;

function detectAllowedImageMimeType(
  buffer: Buffer,
): AllowedImageMimeType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

function collectFiles(req: Request): Express.Multer.File[] {
  const uploadedFiles = req.files;
  if (req.file) return [req.file];
  if (!uploadedFiles) return [];
  if (Array.isArray(uploadedFiles)) return uploadedFiles;
  return Object.values(uploadedFiles).flat();
}

/**
 * Multer configuration using memory storage for streaming uploads.
 *
 * Instead of writing to disk first, files are held in memory as Buffers
 * and can be streamed directly to storage services (Cloudinary, local disk).
 * This eliminates the intermediate disk I/O step and improves upload performance.
 *
 * The file will be available as `req.file.buffer` instead of `req.file.path`.
 */
const storage = multer.memoryStorage();

const fileFilter = (
  _req: unknown,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) => {
  if (
    allowedMimeTypes.includes(
      normalizeMimeType(file.mimetype) as AllowedImageMimeType,
    )
  ) {
    cb(null, true);
  } else {
    cb(
      Errors.validation(
        "Invalid file type. Only jpg, jpeg, png, and webp are allowed.",
      ),
    );
  }
};

export const validateImageUpload: RequestHandler = (req, _res, next) => {
  try {
    for (const file of collectFiles(req)) {
      const detectedMimeType = detectAllowedImageMimeType(file.buffer);
      const normalizedMimeType = normalizeMimeType(file.mimetype);

      if (!detectedMimeType || detectedMimeType !== normalizedMimeType) {
        throw Errors.validation("Invalid image content.");
      }

      file.mimetype = detectedMimeType;
    }

    next();
  } catch (error) {
    next(error);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 2,
    fields: 20,
    parts: 30,
    fieldNameSize: 100,
    fieldSize: 64 * 1024,
    headerPairs: 100,
  },
  fileFilter,
});

export default upload;
