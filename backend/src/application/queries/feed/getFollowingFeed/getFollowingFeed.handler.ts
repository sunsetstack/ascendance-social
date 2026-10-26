import { inject, injectable } from "tsyringe";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { IFeedReadDao, IUserReadRepository } from "@/repositories/interfaces";
import { FollowRepository } from "@/repositories/follow.repository";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import type { CursorPaginationResult, FeedPost } from "@/types";
import { asMongoId, asUserPublicId } from "@/types/branded";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import { GetFollowingFeedQuery } from "./getFollowingFeed.query";

@injectable()
export class GetFollowingFeedQueryHandler implements IQueryHandler<GetFollowingFeedQuery, CursorPaginationResult<FeedPost>> {
  constructor(
    @inject(TOKENS.Repositories.UserRead) private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.Follow) private readonly follows: FollowRepository,
    @inject(TOKENS.Repositories.FeedReadDao) private readonly feeds: IFeedReadDao,
    @inject(TOKENS.Services.FeedEnrichment) private readonly enrichment: FeedEnrichmentService,
  ) {}

  async execute(query: GetFollowingFeedQuery): Promise<CursorPaginationResult<FeedPost>> {
    const user = await this.users.findByPublicId(asUserPublicId(query.userId));
    if (!user) throw Errors.notFound("User");
    const viewer = asMongoId(String(user._id));
    const following = await this.follows.getFollowingObjectIds(viewer);
    const result = await this.feeds.getFollowingFeedWithCursor(viewer, following, { limit: query.limit, cursor: query.cursor });
    return { data: await this.enrichment.enrichFeedWithCurrentData(normalizeFeedPosts(result.data)),
      hasMore: result.hasMore, nextCursor: result.nextCursor };
  }
}
