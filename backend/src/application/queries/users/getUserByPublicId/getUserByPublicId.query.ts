import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetUserByPublicIdQuery implements IQuery {
  readonly type = "GetUserByPublicIdQuery";

  constructor(public readonly publicId: UserPublicId) {}
}
