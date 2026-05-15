import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class PromoteToAdminCommand implements ICommand {
  readonly type = "PromoteToAdminCommand";

  constructor(public readonly userPublicId: UserPublicId) {}
}
