import { Response } from "express";
import { inject, injectable } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { AddFavoriteCommand } from "@/application/commands/favorite/addFavorite/addFavorite.command";
import { RemoveFavoriteCommand } from "@/application/commands/favorite/removeFavorite/removeFavorite.command";
import { GetFavoritesQuery } from "@/application/queries/favorite/getFavorites/getFavorites.query";
import { Errors } from "@/utils/errors";
import { TypedRequest, PaginationResult, PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId } from "@/types/branded";
import type { PublicIdParams as PostPublicIdParams } from "@/utils/schemas/post.schemas";
import type { PublicUserListQuery } from "@/utils/schemas/user.schemas";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class FavoriteController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  /**
   *  Add a post to the logged-in user's favorites list.
   */
  addFavorite = async (
    req: TypedRequest<PostPublicIdParams>,
    res: Response,
  ) => {
    const actorPublicId = req.decodedUser?.publicId;
    if (!actorPublicId) {
      throw Errors.authentication("User must be logged in to favorite a post");
    }

    const sanitizedPostId = req.params.publicId.replace(
      /\.[a-z0-9]{2,5}$/i,
      "",
    );

    await this.commandBus.dispatch(
      new AddFavoriteCommand(actorPublicId, asPostPublicId(sanitizedPostId)),
    );
    res.status(204).send();
  };

  /**
   * Remove a post from the logged-in user's favorites list.
   */
  removeFavorite = async (
    req: TypedRequest<PostPublicIdParams>,
    res: Response,
  ) => {
    const actorPublicId = req.decodedUser?.publicId;
    if (!actorPublicId) {
      throw Errors.authentication(
        "User must be logged in to unfavorite a post",
      );
    }

    const sanitizedPostId = req.params.publicId.replace(
      /\.[a-z0-9]{2,5}$/i,
      "",
    );

    await this.commandBus.dispatch(
      new RemoveFavoriteCommand(actorPublicId, asPostPublicId(sanitizedPostId)),
    );
    res.status(204).send();
  };

  /**
   * Get the list of favorited posts for a specific user profile.
   */
  getFavorites = async (
    req: TypedRequest<EmptyParams, EmptyBody, PublicUserListQuery>,
    res: Response,
  ) => {
    const viewerPublicId = req.decodedUser?.publicId;
    if (!viewerPublicId) {
      throw Errors.authentication("User must be logged in to view favorites");
    }

    const { page, limit } = req.query;

    const favorites = await this.queryBus.execute<PaginationResult<PostDTO>>(
      new GetFavoritesQuery(viewerPublicId, Number(page), Number(limit)),
    );
    res.status(200).json(favorites);
  };
}
