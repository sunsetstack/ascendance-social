import { PostPublicId, UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetPostByPublicIdQuery implements IQuery {
  readonly type = "GetPostByPublicIdQuery";

  constructor(
    public readonly publicId: PostPublicId,
    public readonly viewerPublicId?: UserPublicId,
  ) {}
}
