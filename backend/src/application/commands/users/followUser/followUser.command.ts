import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class FollowUserCommand implements ICommand {
  readonly type = "FollowUserCommand";
  constructor(
    public readonly followerPublicId: UserPublicId,
    public readonly followeePublicId: UserPublicId,
  ) {}
}
