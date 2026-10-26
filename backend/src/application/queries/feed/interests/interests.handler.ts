import { inject, injectable } from "tsyringe";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { IFeedReadDao, IUserReadRepository } from "@/repositories/interfaces";
import { FeedPreferenceRepository } from "@/repositories/feed-preference.repository";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { INTERESTS, type InterestProfile } from "@/services/feed/interests.policy";
import { normalizeFeedPosts } from "@/application/queries/feed/feed-post-normalizer";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";
import type { CursorPaginationResult, FeedPost } from "@/types";
import { Errors } from "@/utils/errors";
import { GetInterestsQuery, GetInterestFeedQuery } from "./interests.query";

export interface InterestsResult {
  catalogue: { id: string; name: string; nameBg: string }[];
  profile: InterestProfile | null;
}

@injectable()
export class GetInterestsQueryHandler implements IQueryHandler<GetInterestsQuery, InterestsResult> {
  constructor(
    @inject(TOKENS.Repositories.UserRead) private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.FeedPreference) private readonly preferences: FeedPreferenceRepository,
  ) {}

  async execute(query: GetInterestsQuery): Promise<InterestsResult> {
    let profile: InterestProfile | null = null;
    if (query.userPublicId) {
      const user = await this.users.findByPublicId(asUserPublicId(query.userPublicId));
      if (!user) throw Errors.notFound("User");
      profile = await this.preferences.read(String(user._id));
    }
    return { catalogue: INTERESTS.map(({ id, name, nameBg }) => ({ id, name, nameBg })), profile };
  }
}

@injectable()
export class GetInterestFeedQueryHandler implements IQueryHandler<GetInterestFeedQuery, CursorPaginationResult<FeedPost>> {
  constructor(
    @inject(TOKENS.Repositories.UserRead) private readonly users: IUserReadRepository,
    @inject(TOKENS.Repositories.FeedReadDao) private readonly feeds: IFeedReadDao,
    @inject(TOKENS.Services.FeedEnrichment) private readonly enrichment: FeedEnrichmentService,
  ) {}

  async execute(query: GetInterestFeedQuery): Promise<CursorPaginationResult<FeedPost>> {
    const user = query.definition.viewer ? await this.users.findByPublicId(asUserPublicId(query.definition.viewer)) : null;
    if (query.definition.viewer && !user) throw Errors.notFound("User");
    const result = await this.feeds.getInterestFeedWithCursor({ ...query.definition, viewerMongoId: user ? String(user._id) : undefined }, { limit: query.limit, cursor: query.cursor });
    return { ...result, data: await this.enrichment.enrichFeedWithCurrentData(normalizeFeedPosts(result.data)) };
  }
}
