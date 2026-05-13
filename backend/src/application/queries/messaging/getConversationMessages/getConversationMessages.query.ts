import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetConversationMessagesQuery implements IQuery {
  public readonly type = 'GetConversationMessagesQuery';
  constructor(
    public readonly userPublicId: string,
    public readonly conversationPublicId: string,
    public readonly page?: number,
    public readonly limit?: number,
  ) {}
}
