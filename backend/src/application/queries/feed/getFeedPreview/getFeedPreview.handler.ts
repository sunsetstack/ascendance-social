import { inject, injectable } from "tsyringe";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { IFeedReadDao } from "@/repositories/interfaces";
import type { CursorPaginationResult, FeedPost } from "@/types";
import { TOKENS } from "@/types/tokens";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import { GetFeedPreviewQuery } from "./getFeedPreview.query";

@injectable()
export class GetFeedPreviewQueryHandler implements IQueryHandler<GetFeedPreviewQuery, CursorPaginationResult<FeedPost>> {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao) private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Services.FeedEnrichment) private readonly enrichment: FeedEnrichmentService,
  ) {}

  async execute(query: GetFeedPreviewQuery): Promise<CursorPaginationResult<FeedPost>> {
    const result = await this.feedReadDao.getPreviewFeedWithCursor(query.definition, {
      limit: query.limit, cursor: query.cursor,
    });
    return {
      data: await this.enrichment.enrichFeedWithCurrentData(normalizeFeedPosts(result.data)),
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    };
  }
}
