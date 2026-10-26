import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class RepostPostCommand implements ICommand {
  readonly type = "RepostPostCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly targetPostPublicId: PostPublicId,
    public readonly body?: string,
    public readonly imageBuffer?: Buffer,
    public readonly imageMimeType?: string,
    public readonly imageOriginalName?: string,
  ) {}
}
