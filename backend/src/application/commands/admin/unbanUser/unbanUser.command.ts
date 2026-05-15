import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class UnbanUserCommand implements ICommand {
  readonly type = "UnbanUserCommand";

  constructor(public readonly userPublicId: UserPublicId) {}
}
