import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class MarkConversationReadCommand implements ICommand {
  public readonly type = "MarkConversationReadCommand";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly conversationPublicId: string,
  ) {}
}
