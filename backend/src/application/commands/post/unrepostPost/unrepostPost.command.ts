import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class UnrepostPostCommand implements ICommand {
  readonly type = "UnrepostPostCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly targetPostPublicId: PostPublicId,
  ) {}
}
