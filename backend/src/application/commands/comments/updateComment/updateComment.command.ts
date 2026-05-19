import { ICommand } from "@/application/common/interfaces/command.interface";
import { UserPublicId } from "@/types/branded";

export class UpdateCommentCommand implements ICommand {
  readonly type = "UpdateCommentCommand";

  constructor(
    public readonly commentId: string,
    public readonly userPublicId: UserPublicId,
    public readonly content: string,
  ) {}
}
