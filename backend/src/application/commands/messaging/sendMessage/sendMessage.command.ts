import { ICommand } from "@/application/common/interfaces/command.interface";
import { SendMessagePayload } from "@/types";

export class SendMessageCommand implements ICommand {
  public readonly type = 'SendMessageCommand';
  constructor(
    public readonly senderPublicId: string,
    public readonly payload: SendMessagePayload,
    public readonly file?: Express.Multer.File,
  ) {}
}
