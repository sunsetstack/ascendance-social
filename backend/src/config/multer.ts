import multer from "multer";
import { Errors } from "@/utils/errors";

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

const fileFilter = (req: unknown, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
	const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
	if (allowedMimeTypes.includes(file.mimetype)) {
		cb(null, true);
	} else {
		cb(Errors.validation("Invalid file type. Only jpg, jpeg, png, and webp are allowed."));
	}
};

const upload = multer({
	storage,
	limits: {
		fileSize: 10 * 1024 * 1024, // 10MB
	},
	fileFilter,
});

export default upload;
