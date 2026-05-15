import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetFollowingQuery implements IQuery {
  readonly type = "GetFollowingQuery";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly page: number = 1,
    public readonly limit: number = 20,
  ) {}
}
