import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class DemoteFromAdminCommand implements ICommand {
  readonly type = "DemoteFromAdminCommand";

  constructor(public readonly userPublicId: UserPublicId) {}
}
