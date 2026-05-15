import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class RecordPostViewCommand implements ICommand {
  readonly type = "RecordPostViewCommand";

  constructor(
    public readonly postPublicId: PostPublicId,
    public readonly userPublicId: UserPublicId, // only authenticated users
  ) {}
}
