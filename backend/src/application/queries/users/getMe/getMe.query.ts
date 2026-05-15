import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

// Query now expects a publicId (not internal Mongo _id)
export class GetMeQuery implements IQuery {
  readonly type = "GetMeQuery";
  constructor(public readonly publicId: UserPublicId) {}
}
