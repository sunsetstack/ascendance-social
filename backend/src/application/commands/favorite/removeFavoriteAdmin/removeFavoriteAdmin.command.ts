import { UserPublicId, PostPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class RemoveFavoriteAdminCommand implements ICommand {
  public readonly type = "RemoveFavoriteAdminCommand";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly postPublicId: PostPublicId,
  ) {}
}
