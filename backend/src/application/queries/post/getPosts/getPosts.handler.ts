import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetPostsQuery } from "./getPosts.query";
import { FeedReadService } from "@/services/feed/feed-read.service";
import { PaginationResult, PostDTO } from "@/types";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetPostsQueryHandler implements IQueryHandler<
  GetPostsQuery,
  PaginationResult<PostDTO>
> {
  constructor(
    @inject(TOKENS.Services.FeedRead)
    private readonly feedReadService: FeedReadService,
  ) {}

  async execute(query: GetPostsQuery): Promise<PaginationResult<PostDTO>> {
    if (query.userId) {
      logger.info(
        `[GetPostsQuery] Fetching paginated public feed for authenticated user ${query.userId}`,
      );
    }

    logger.info("[GetPostsQuery] Fetching paginated public feed");
    return await this.feedReadService.getTrendingFeed(query.page, query.limit);
  }
}
