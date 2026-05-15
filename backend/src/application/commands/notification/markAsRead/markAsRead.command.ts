import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class MarkAsReadCommand implements ICommand {
  public readonly type = "MarkAsReadCommand";
  constructor(
    public readonly notificationId: string,
    public readonly userPublicId: UserPublicId,
  ) {}
}
