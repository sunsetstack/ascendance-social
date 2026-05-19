import { IQuery } from "@/application/common/interfaces/query.interface";
import { UserPublicId } from "@/types/branded";

export class GetCommentsByUserQuery implements IQuery {
  readonly type = "GetCommentsByUserQuery";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly page = 1,
    public readonly limit = 10,
    public readonly sortBy = "createdAt",
    public readonly sortOrder: "asc" | "desc" = "desc",
  ) {}
}
