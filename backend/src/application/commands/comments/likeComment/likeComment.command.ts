import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class LikeCommentCommand implements ICommand {
  readonly type = "LikeCommentCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly commentId: string,
  ) {}
}
