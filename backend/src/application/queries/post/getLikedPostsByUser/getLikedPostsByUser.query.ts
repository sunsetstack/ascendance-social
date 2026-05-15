import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetLikedPostsByUserQuery implements IQuery {
  readonly type = "GetLikedPostsByUserQuery";

  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly page: number,
    public readonly limit: number,
    public readonly viewerPublicId?: UserPublicId,
    public readonly sortBy: string = "createdAt",
    public readonly sortOrder: "asc" | "desc" = "desc",
  ) {}
}
