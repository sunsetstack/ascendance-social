import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class LikeActionByPublicIdCommand implements ICommand {
  readonly type = "LikeActionByPublicIdCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly postPublicId: PostPublicId,
  ) {}
}
