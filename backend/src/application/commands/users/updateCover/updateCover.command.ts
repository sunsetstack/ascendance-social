import { ICommand } from "@/application/common/interfaces/command.interface";

export class UpdateCoverCommand implements ICommand {
	readonly type = "UpdateCoverCommand";

	constructor(
		public readonly userPublicId: string,
		public readonly fileBuffer: Buffer,
		public readonly originalName?: string,
		public readonly mimeType?: string,
	) {}
}
