import { Response } from "express";
import { inject, injectable } from "tsyringe";
import { Errors } from "@/utils/errors";
import { QueryBus } from "@/application/common/buses/query.bus";
import { GetTrendingTagsQuery } from "@/application/queries/tags/getTrendingTags/getTrendingTags.query";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";
import { GetTrendingFeedQuery } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.query";
import { GetNewFeedQuery } from "@/application/queries/feed/getNewFeed/getNewFeed.query";
import {
  streamPaginatedResponse,
  streamCursorResponse,
} from "@/utils/streamResponse";
import {
  CursorPaginationResult,
  FeedPost,
  PaginationResult,
  PostDTO,
  TypedRequest,
} from "@/types";
import { TOKENS } from "@/types/tokens";
import type {
  FeedPaginationQuery,
  NewFeedQuery,
  TrendingTagsQuery,
} from "@/utils/schemas/feed.schemas";

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class FeedController {
  constructor(
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

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
      await this.queryBus.execute<CursorPaginationResult<FeedPost>>(query);

    // Use streaming for large responses with cursor pagination
    if (feed.data && feed.data.length >= STREAM_THRESHOLD) {
      streamCursorResponse(res, feed.data, {
        hasMore: feed.hasMore,
        nextCursor: feed.nextCursor,
      });
    } else {
      res.json(feed);
    }
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
    const feed =
      await this.queryBus.execute<CursorPaginationResult<FeedPost>>(query);

    // Use streaming for large responses with cursor pagination
    if (feed.data && feed.data.length >= STREAM_THRESHOLD) {
      streamCursorResponse(res, feed.data, {
        hasMore: feed.hasMore,
        nextCursor: feed.nextCursor,
      });
    } else {
      res.json(feed);
    }
  };

  getTrendingFeed = async (
    req: TypedRequest<EmptyParams, EmptyBody, FeedPaginationQuery>,
    res: Response,
  ) => {
    const { page, limit, cursor } = req.query;

    const query = new GetTrendingFeedQuery(page, limit, cursor);
    const feed =
      await this.queryBus.execute<CursorPaginationResult<FeedPost>>(query);

    // Use streaming for large responses with cursor pagination
    if (feed.data && feed.data.length >= STREAM_THRESHOLD) {
      streamCursorResponse(res, feed.data, {
        hasMore: feed.hasMore,
        nextCursor: feed.nextCursor,
      });
    } else {
      res.json(feed);
    }
  };

  getNewFeed = async (
    req: TypedRequest<EmptyParams, EmptyBody, NewFeedQuery>,
    res: Response,
  ) => {
    const { page, limit, cursor, refresh } = req.query;
    const isAuthenticated = !!req.decodedUser;

    // only allow cache bypass for authenticated users requesting a refresh
    const forceRefresh = refresh && isAuthenticated;

    const feed = await this.queryBus.execute<
      PaginationResult<PostDTO> & { nextCursor?: string }
    >(new GetNewFeedQuery(page, limit, forceRefresh, cursor));

    // Use cursor-based streaming if cursor is available
    if (feed.nextCursor && feed.data && feed.data.length >= STREAM_THRESHOLD) {
      streamCursorResponse(res, feed.data, {
        hasMore: feed.data.length >= limit,
        nextCursor: feed.nextCursor,
      });
    } else if (feed.data && feed.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, feed.data, {
        total: feed.total,
        page: feed.page,
        limit: feed.limit,
        totalPages: feed.totalPages,
      });
    } else {
      res.json(feed);
    }
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
