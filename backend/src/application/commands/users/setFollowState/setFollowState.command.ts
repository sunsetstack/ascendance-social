import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class SetFollowStateCommand implements ICommand {
  readonly type = "SetFollowStateCommand";
  constructor(
    public readonly followerPublicId: UserPublicId,
    public readonly followeePublicId: UserPublicId,
    public readonly shouldFollow: boolean,
  ) {}
}
