import { ICommand } from "@/application/common/interfaces/command.interface";
import { ConversationPublicId, UserPublicId } from "@/types/branded";

export type ConversationAction = "delete" | "purge" | "lock" | "unlock";

export class ManageConversationCommand implements ICommand {
  public readonly type = "ManageConversationCommand";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly conversationPublicId: ConversationPublicId,
    public readonly action: ConversationAction,
  ) {}
}
