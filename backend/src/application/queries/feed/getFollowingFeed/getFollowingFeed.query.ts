import type { IQuery } from "@/application/common/interfaces/query.interface";

export class GetFollowingFeedQuery implements IQuery {
  readonly type = "GetFollowingFeedQuery";
  constructor(
    public readonly userId: string,
    public readonly limit: number,
    public readonly cursor?: string,
  ) {}
}
