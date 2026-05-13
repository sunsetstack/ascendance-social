import { ICommand } from "@/application/common/interfaces/command.interface";

export class InitiateConversationCommand implements ICommand {
  public readonly type = 'InitiateConversationCommand';
  constructor(
    public readonly userPublicId: string,
    public readonly recipientPublicId: string,
  ) {}
}
