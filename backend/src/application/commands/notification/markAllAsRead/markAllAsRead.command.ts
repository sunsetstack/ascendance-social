import { ICommand } from "@/application/common/interfaces/command.interface";

export class MarkAllAsReadCommand implements ICommand {
  public readonly type = 'MarkAllAsReadCommand';
  constructor(public readonly userPublicId: string) {}
}
