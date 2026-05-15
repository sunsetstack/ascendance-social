import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class CreateCommentCommand implements ICommand {
  readonly type = "CreateCommentCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly postPublicId: PostPublicId,
    public readonly content: string,
    public readonly parentId: string | null = null,
  ) {}
}
