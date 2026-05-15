import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetWhoToFollowQuery implements IQuery {
  readonly type = "GetWhoToFollowQuery";
  constructor(
    public readonly userPublicId: UserPublicId,
    public readonly limit: number = 5,
  ) {}
}
