import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class BanUserCommand implements ICommand {
  readonly type = "BanUserCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly adminPublicId: UserPublicId,
    public readonly reason: string,
  ) {}
}
