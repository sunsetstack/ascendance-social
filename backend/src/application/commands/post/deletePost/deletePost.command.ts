import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class DeletePostCommand implements ICommand {
  readonly type = "DeletePostCommand";

  constructor(
    public readonly postPublicId: PostPublicId,
    public readonly requesterPublicId: UserPublicId,
  ) {}
}
