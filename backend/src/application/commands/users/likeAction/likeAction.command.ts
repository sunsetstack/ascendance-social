import { MongoId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class LikeActionCommand implements ICommand {
	readonly type = "LikeActionCommand";

	constructor(
		public readonly userId: MongoId,
		public readonly postId: MongoId,
	) {}
}
