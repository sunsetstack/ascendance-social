import { MessagePublicId, UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class DeleteMessageCommand implements ICommand {
  public readonly type = "DeleteMessageCommand";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly messageId: MessagePublicId,
  ) {}
}
