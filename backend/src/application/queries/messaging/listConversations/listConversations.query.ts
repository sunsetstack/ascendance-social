import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class ListConversationsQuery implements IQuery {
  public readonly type = "ListConversationsQuery";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly page?: number,
    public readonly limit?: number,
  ) {}
}
