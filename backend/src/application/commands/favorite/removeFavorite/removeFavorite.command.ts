import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class RemoveFavoriteCommand implements ICommand {
  public readonly type = "RemoveFavoriteCommand";
  constructor(
    public readonly actorPublicId: UserPublicId,
    public readonly postPublicId: PostPublicId,
  ) {}
}
