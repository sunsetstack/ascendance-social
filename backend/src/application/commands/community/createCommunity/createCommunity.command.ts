import { ICommand } from "@/application/common/interfaces/command.interface";

export class CreateCommunityCommand implements ICommand {
	readonly type = "CreateCommunityCommand";

	constructor(
		public readonly name: string,
		public readonly description: string,
		public readonly creatorId: string,
		public readonly avatarBuffer?: Buffer,
		public readonly avatarOriginalName?: string,
		public readonly avatarMimeType?: string,
	) {}
}
