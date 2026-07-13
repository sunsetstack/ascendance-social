import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class DeleteUserCommand implements ICommand {
  readonly type = "DeleteUserCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly password?: string,
    public readonly skipPasswordVerification: boolean = false,
    public readonly reason: string = "self_requested_account_deletion",
    public readonly requestedByPublicId?: UserPublicId,
  ) {}
}
