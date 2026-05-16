import { ConversationPublicId, UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetConversationMessagesQuery implements IQuery {
  public readonly type = "GetConversationMessagesQuery";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly conversationPublicId: ConversationPublicId,
    public readonly page?: number,
    public readonly limit?: number,
  ) {}
}
