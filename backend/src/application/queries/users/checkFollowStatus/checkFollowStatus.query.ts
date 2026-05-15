import { UserPublicId } from "@/types/branded";
import { IQuery } from "@/application/common/interfaces/query.interface";

export class CheckFollowStatusQuery implements IQuery {
  readonly type = "CheckFollowStatusQuery";

  constructor(
    public readonly followerPublicId: UserPublicId,
    public readonly targetPublicId: UserPublicId,
  ) {}
}
