import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetCommentThreadQuery implements IQuery {
  readonly type = "GetCommentThreadQuery";

  constructor(public readonly commentId: string) {}
}
