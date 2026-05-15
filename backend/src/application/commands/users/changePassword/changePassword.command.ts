import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class ChangePasswordCommand implements ICommand {
  readonly type = "ChangePasswordCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly currentPassword: string,
    public readonly newPassword: string,
  ) {}
}
