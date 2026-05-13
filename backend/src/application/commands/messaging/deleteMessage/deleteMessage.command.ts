import { ICommand } from "@/application/common/interfaces/command.interface";

export class DeleteMessageCommand implements ICommand {
  public readonly type = 'DeleteMessageCommand';
  constructor(
    public readonly userPublicId: string,
    public readonly messageId: string,
  ) {}
}
