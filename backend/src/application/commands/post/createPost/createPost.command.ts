import { ICommand } from "@/application/common/interfaces/command.interface";

export class CreatePostCommand implements ICommand {
	readonly type = "CreatePostCommand";

	constructor(
		public readonly userPublicId: string,
		public readonly body?: string,
		public readonly tags?: string[],
		/** @deprecated Use imageBuffer for better performance */
		public readonly imagePath?: string,
		public readonly imageOriginalName?: string,
		public readonly communityPublicId?: string,
		/** Image data as Buffer from memory storage (preferred) */
		public readonly imageBuffer?: Buffer,
		/** MIME type of the image */
		public readonly imageMimeType?: string,
	) {}
}
