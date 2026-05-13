import { ICommand } from "@/application/common/interfaces/command.interface";

export class MarkConversationReadCommand implements ICommand {
  public readonly type = 'MarkConversationReadCommand';
  constructor(
    public readonly userPublicId: string,
    public readonly conversationPublicId: string,
  ) {}
}
