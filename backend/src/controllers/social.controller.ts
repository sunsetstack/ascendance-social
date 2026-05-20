import { Request, Response } from "express";
import { injectable, inject } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { SetFollowStateCommand } from "@/application/commands/users/setFollowState/setFollowState.command";
import { SetFollowStateResult } from "@/application/commands/users/setFollowState/setFollowState.handler";
import { LikeActionByPublicIdCommand } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.command";
import { CheckFollowStatusQuery } from "@/application/queries/users/checkFollowStatus/checkFollowStatus.query";
import { GetFollowersQuery } from "@/application/queries/users/getFollowers/getFollowers.query";
import { GetFollowersResult } from "@/application/queries/users/getFollowers/getFollowers.handler";
import { GetFollowingQuery } from "@/application/queries/users/getFollowing/getFollowing.query";
import { GetFollowingResult } from "@/application/queries/users/getFollowing/getFollowing.handler";
import { GetWhoToFollowQuery } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.query";
import { GetWhoToFollowResult } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.handler";
import { GetHandleSuggestionsQuery } from "@/application/queries/users/getHandleSuggestions/getHandleSuggestions.query";
import { HandleSuggestionDTO } from "@/services/dto.service";
import { TypedRequest } from "@/types";
import type {
  HandleSuggestionsQuery as HandleSuggestionsQueryParams,
  PublicIdParams as UserPublicIdParams,
  PublicUserListQuery,
  WhoToFollowQuery,
} from "@/utils/schemas/user.schemas";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId, asPostPublicId, UserPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { streamPaginatedResponse } from "@/utils/streamResponse";
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyBody = Record<string, never>;

@injectable()
export class SocialController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  private requireAuthenticatedUserPublicId(req: Request): UserPublicId {
    const userPublicId = req.decodedUser?.publicId;
    if (!userPublicId) {
      throw Errors.authentication("Authentication required");
    }
    return userPublicId;
  }

  followUserByPublicId = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const result = await this.commandBus.dispatch<SetFollowStateResult>(
      new SetFollowStateCommand(
        this.requireAuthenticatedUserPublicId(req),
        asUserPublicId(publicId),
        true,
      ),
    );
    res.status(200).json(result);
  };

  unfollowUserByPublicId = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const result = await this.commandBus.dispatch<SetFollowStateResult>(
      new SetFollowStateCommand(
        this.requireAuthenticatedUserPublicId(req),
        asUserPublicId(publicId),
        false,
      ),
    );
    res.status(200).json(result);
  };

  checkFollowStatus = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const followerPublicId = this.requireAuthenticatedUserPublicId(req);
    const query = new CheckFollowStatusQuery(
      followerPublicId,
      asUserPublicId(publicId),
    );
    const isFollowing = await this.queryBus.execute<boolean>(query);
    res.status(200).json({ isFollowing });
  };

  getFollowers = async (
    req: TypedRequest<UserPublicIdParams, EmptyBody, PublicUserListQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit } = req.query;
    const query = new GetFollowersQuery(asUserPublicId(publicId), page, limit);
    const result = await this.queryBus.execute<GetFollowersResult>(query);

    if (result.users.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(
        res,
        result.users,
        {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        { arrayKey: "users" },
      );
    } else {
      res.status(200).json(result);
    }
  };

  getFollowing = async (
    req: TypedRequest<UserPublicIdParams, EmptyBody, PublicUserListQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit } = req.query;
    const query = new GetFollowingQuery(asUserPublicId(publicId), page, limit);
    const result = await this.queryBus.execute<GetFollowingResult>(query);

    if (result.users.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(
        res,
        result.users,
        {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        { arrayKey: "users" },
      );
    } else {
      res.status(200).json(result);
    }
  };

  getWhoToFollow = async (
    req: TypedRequest<never, EmptyBody, WhoToFollowQuery>,
    res: Response,
  ) => {
    const { limit } = req.query;
    const userPublicId = this.requireAuthenticatedUserPublicId(req);
    const query = new GetWhoToFollowQuery(userPublicId, limit);
    const result = await this.queryBus.execute<GetWhoToFollowResult>(query);
    res.status(200).json(result);
  };

  getHandleSuggestions = async (
    req: TypedRequest<never, EmptyBody, HandleSuggestionsQueryParams>,
    res: Response,
  ) => {
    const { q: queryValue, context, limit } = req.query;
    const viewerPublicId = req.decodedUser?.publicId;
    const query = new GetHandleSuggestionsQuery(
      queryValue,
      context,
      limit,
      viewerPublicId,
    );
    const result = await this.queryBus.execute<HandleSuggestionDTO[]>(query);
    res.status(200).json({ users: result });
  };

  likeActionByPublicId = async (req: Request, res: Response) => {
    let { publicId } = req.params;
    const userPublicId = this.requireAuthenticatedUserPublicId(req);

    // strip file extension for backward compatibility
    publicId = publicId.replace(/\.[a-z0-9]{2,5}$/i, "");

    const command = new LikeActionByPublicIdCommand(
      userPublicId,
      asPostPublicId(publicId),
    );
    const result = await this.commandBus.dispatch(command);
    res.status(200).json(result);
  };
}
