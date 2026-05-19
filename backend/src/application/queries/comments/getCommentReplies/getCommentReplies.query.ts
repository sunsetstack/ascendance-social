import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetCommentRepliesQuery implements IQuery {
  readonly type = "GetCommentRepliesQuery";

  constructor(
    public readonly commentId: string,
    public readonly page = 1,
    public readonly limit = 10,
  ) {}
}
