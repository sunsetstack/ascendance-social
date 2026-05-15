import { UserPublicId } from "@/types/branded";
import { ICommand } from "@/application/common/interfaces/command.interface";

export class InitiateConversationCommand implements ICommand {
  public readonly type = "InitiateConversationCommand";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly recipientPublicId: UserPublicId,
  ) {}
}
