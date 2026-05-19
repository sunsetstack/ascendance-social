import { IQuery } from "@/application/common/interfaces/query.interface";

export class GetNewFeedQuery implements IQuery {
  readonly type = "GetNewFeedQuery";

  constructor(
    public readonly page: number,
    public readonly limit: number,
    public readonly forceRefresh = false,
    public readonly cursor?: string,
  ) {}
}
