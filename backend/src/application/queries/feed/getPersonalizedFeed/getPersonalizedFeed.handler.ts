import { inject, injectable } from "tsyringe";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { CursorPaginationResult, FeedPost } from "@/types";
import { TOKENS } from "@/types/tokens";
import { GetForYouFeedQueryHandler } from "../getForYouFeed/getForYouFeed.handler";
import { GetForYouFeedQuery } from "../getForYouFeed/getForYouFeed.query";
import { GetPersonalizedFeedQuery } from "./getPersonalizedFeed.query";

@injectable()
export class GetPersonalizedFeedQueryHandler implements IQueryHandler<GetPersonalizedFeedQuery, CursorPaginationResult<FeedPost>> {
  constructor(
    @inject(TOKENS.CQRS.Queries.GetForYouFeed) private readonly forYou: GetForYouFeedQueryHandler,
  ) {}

  async execute(query: GetPersonalizedFeedQuery): Promise<CursorPaginationResult<FeedPost>> {
    const result = await this.forYou.execute(new GetForYouFeedQuery(query.userId, query.page, query.limit, query.cursor, "home"));
    return { data: result.data, hasMore: result.hasMore ?? false, nextCursor: result.nextCursor };
  }
}
