import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetNewFeedQuery } from "./getNewFeed.query";
import { PaginationResult, PostDTO } from "@/types";
import { FeedReadService } from "@/services/feed/feed-read.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetNewFeedQueryHandler implements IQueryHandler<
  GetNewFeedQuery,
  PaginationResult<PostDTO> & { nextCursor?: string }
> {
  constructor(
    @inject(TOKENS.Services.FeedRead)
    private readonly feedReadService: FeedReadService,
  ) {}

  async execute(
    query: GetNewFeedQuery,
  ): Promise<PaginationResult<PostDTO> & { nextCursor?: string }> {
    return this.feedReadService.getNewFeed(
      query.page,
      query.limit,
      query.forceRefresh,
      query.cursor,
    );
  }
}
