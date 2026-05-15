import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetConversationMessagesQuery implements IQuery {
  public readonly type = "GetConversationMessagesQuery";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly conversationPublicId: string,
    public readonly page?: number,
    public readonly limit?: number,
  ) {}
}
