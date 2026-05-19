import { IQuery } from "@/application/common/interfaces/query.interface";
import { PostPublicId } from "@/types/branded";

export class GetCommentsByPostQuery implements IQuery {
  readonly type = "GetCommentsByPostQuery";

  constructor(
    public readonly postPublicId: PostPublicId,
    public readonly page = 1,
    public readonly limit = 10,
    public readonly parentId: string | null = null,
  ) {}
}
