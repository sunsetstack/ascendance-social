import { ICommand } from "@/application/common/interfaces/command.interface";

export class CreateNotificationCommand implements ICommand {
  public readonly type = 'CreateNotificationCommand';
  constructor(
    public readonly payload: {
      receiverId: string;
      actionType: string;
      actorId: string;
      targetId?: string;
      targetType?: string;
      targetPreview?: string;
      actorUsername?: string;
      actorHandle?: string;
      actorAvatar?: string;
      idempotencyKey?: string;
    }
  ) {}
}
