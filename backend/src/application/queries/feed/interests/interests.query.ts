import type { IQuery } from "@/application/common/interfaces/query.interface";
import type { InterestFeedDefinition } from "@/services/feed/interests.policy";

export class GetInterestsQuery implements IQuery {
  readonly type = "GetInterestsQuery";
  constructor(public readonly userPublicId?: string) {}
}

export class GetInterestFeedQuery implements IQuery {
  readonly type = "GetInterestFeedQuery";
  constructor(
    public readonly definition: InterestFeedDefinition,
    public readonly limit: number,
    public readonly cursor?: string,
  ) {}
}
