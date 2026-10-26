import { Response } from "express";
import { inject, injectable } from "tsyringe";
import { Errors } from "@/utils/errors";
import { QueryBus } from "@/application/common/buses/query.bus";
import { GetTrendingTagsQuery } from "@/application/queries/tags/getTrendingTags/getTrendingTags.query";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";
import { GetFollowingFeedQuery } from "@/application/queries/feed/getFollowingFeed/getFollowingFeed.query";
import { GetTrendingFeedQuery } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.query";
import { GetNewFeedQuery } from "@/application/queries/feed/getNewFeed/getNewFeed.query";
import { GetFeedPreviewQuery } from "@/application/queries/feed/getFeedPreview/getFeedPreview.query";
import { GetInterestsQuery, GetInterestFeedQuery } from "@/application/queries/feed/interests/interests.query";
import { UpdateInterestsCommand } from "@/application/commands/feed/updateInterests/updateInterests.command";
import { CommandBus } from "@/application/common/buses/command.bus";
import type { InterestFeedQuery, SelectInterestsBody } from "@/utils/schemas/feed.schemas";
import { TypedRequest } from "@/types";
import { TOKENS } from "@/types/tokens";
import type {
  FeedPaginationQuery,
  FeedPreviewQuery,
  NewFeedQuery,
  TrendingTagsQuery,
} from "@/utils/schemas/feed.schemas";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class FeedController {
  constructor(
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
  ) {}

  getInterests = async (req: TypedRequest, res: Response): Promise<void> => {
    res.json(await this.queryBus.execute(new GetInterestsQuery(req.decodedUser?.publicId)));
  };

  selectInterests = async (req: TypedRequest<EmptyParams, SelectInterestsBody>, res: Response): Promise<void> => {
    if (!req.decodedUser?.publicId) throw Errors.authentication("User authentication required");
    await this.commandBus.dispatch(new UpdateInterestsCommand(req.decodedUser.publicId, "select", req.body.selected));
    res.status(204).send();
  };

  resetPreferences = async (req: TypedRequest, res: Response): Promise<void> => {
    if (!req.decodedUser?.publicId) throw Errors.authentication("User authentication required");
    await this.commandBus.dispatch(new UpdateInterestsCommand(req.decodedUser.publicId, "reset"));
    res.status(204).send();
  };

  getInterestFeed = async (req: TypedRequest<EmptyParams, EmptyBody, InterestFeedQuery>, res: Response): Promise<void> => {
    const { topics, sort, limit, cursor } = req.query;
    res.json(await this.queryBus.execute(new GetInterestFeedQuery({ topics, sort, viewer: req.decodedUser?.publicId }, limit, cursor)));
  };

  getFollowingFeed = async (req: TypedRequest<EmptyParams, EmptyBody, FeedPaginationQuery>, res: Response): Promise<void> => {
    if (!req.decodedUser?.publicId) throw Errors.authentication("User authentication required");
    res.json(await this.queryBus.execute(new GetFollowingFeedQuery(req.decodedUser.publicId, req.query.limit, req.query.cursor)));
  };

  getFeedPreview = async (
    req: TypedRequest<EmptyParams, EmptyBody, FeedPreviewQuery>,
    res: Response,
  ): Promise<void> => {
    const { topics, sort, includeReposts, limit, cursor } = req.query;
    const result = await this.queryBus.execute(
      new GetFeedPreviewQuery({ topics, sort, includeReposts }, limit, cursor),
    );
    res.json(result);
  };

  getFeed = async (
    req: TypedRequest<EmptyParams, EmptyBody, FeedPaginationQuery>,
    res: Response,
  ) => {
    const { page, limit, cursor } = req.query;
    if (!req.decodedUser || !req.decodedUser.publicId) {
      throw Errors.validation("User public ID is required");
    }

    const query = new GetPersonalizedFeedQuery(
      req.decodedUser.publicId,
      page,
      limit,
      cursor,
    );
    const feed =
      await this.queryBus.execute(query);

    res.json(feed);
  };

  getForYouFeed = async (
    req: TypedRequest<EmptyParams, EmptyBody, FeedPaginationQuery>,
    res: Response,
  ) => {
    const { page, limit, cursor } = req.query;
    if (!req.decodedUser || !req.decodedUser.publicId) {
      throw Errors.validation("User public ID is required");
    }
    const query = new GetForYouFeedQuery(
      req.decodedUser.publicId,
      page,
      limit,
      cursor,
    );
    const feed = await this.queryBus.execute(query);

    res.json(feed);
  };

  getTrendingFeed = async (
    req: TypedRequest<EmptyParams, EmptyBody, FeedPaginationQuery>,
    res: Response,
  ) => {
    const { page, limit, cursor } = req.query;

    const query = new GetTrendingFeedQuery(page, limit, cursor);
    const feed = await this.queryBus.execute(query);

    res.json(feed);
  };

  getNewFeed = async (
    req: TypedRequest<EmptyParams, EmptyBody, NewFeedQuery>,
    res: Response,
  ) => {
    const { page, limit, cursor, refresh } = req.query;
    const isAuthenticated = !!req.decodedUser;

    // only allow cache bypass for authenticated users requesting a refresh
    const forceRefresh = refresh && isAuthenticated;

    const feed = await this.queryBus.execute(new GetNewFeedQuery(page, limit, forceRefresh, cursor));

    res.json(feed);
  };

  getTrendingTags = async (
    req: TypedRequest<EmptyParams, EmptyBody, TrendingTagsQuery>,
    res: Response,
  ) => {
    const { limit, timeWindowHours } = req.query;

    const query = new GetTrendingTagsQuery(limit, timeWindowHours);
    const result = await this.queryBus.execute(query);

    res.json(result);
  };
}
