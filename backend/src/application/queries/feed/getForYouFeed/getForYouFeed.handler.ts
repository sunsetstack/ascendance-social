import { inject, injectable } from "tsyringe";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { IFeedReadDao, IUserReadRepository } from "@/repositories/interfaces";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import type { PaginatedFeedResult } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { GetForYouFeedQuery } from "./getForYouFeed.query";

@injectable()
export class GetForYouFeedQueryHandler implements IQueryHandler<GetForYouFeedQuery, PaginatedFeedResult> {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao) private readonly feeds: IFeedReadDao,
    @inject(TOKENS.Repositories.UserRead) private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.FeedPreference) private readonly preferences: FeedPreferenceRepository,
    @inject(TOKENS.Services.FeedEnrichment) private readonly enrichment: FeedEnrichmentService,
  ) {}

  async execute(query: GetForYouFeedQuery): Promise<PaginatedFeedResult> {
    const user = await this.users.findByPublicId(asUserPublicId(query.userId));
    if (!user) throw Errors.notFound("User");
    const profile = query.cursor ? undefined : await this.preferences.read(String(user._id));
    const result = await this.feeds.getInterestFeedWithCursor({
      topics: [], sort: "personalized", viewer: query.userId, viewerMongoId: String(user._id), profile,
      destination: query.destination,
    }, { limit: query.limit, cursor: query.cursor });
    return {
      data: await this.enrichment.enrichFeedWithCurrentData(normalizeFeedPosts(result.data)),
      hasMore: result.hasMore, nextCursor: result.nextCursor,
      page: query.page, limit: query.limit, total: 0, totalPages: 0,
    };
  }
}
