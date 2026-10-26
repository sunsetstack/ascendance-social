import type { ICommand } from "@/application/common/interfaces/command.interface";
import type { PostPublicId, UserPublicId } from "@/types/branded";

export class UpdatePostCommand implements ICommand {
  readonly type = "UpdatePostCommand";
  constructor(public readonly postPublicId: PostPublicId, public readonly requesterPublicId: UserPublicId, public readonly body: string) {}
}
