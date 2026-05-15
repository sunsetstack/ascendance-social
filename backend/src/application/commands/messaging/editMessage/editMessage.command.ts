import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class EditMessageCommand implements ICommand {
  public readonly type = "EditMessageCommand";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly messageId: string,
    public readonly newBody: string,
  ) {}
}
