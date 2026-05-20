import express from "express";
import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { FavoriteController } from "../controllers/favorite.controller";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { publicIdSchema as postPublicIdSchema } from "@/utils/schemas/post.schemas";
import { publicUserListQuerySchema } from "@/utils/schemas/user.schemas";

@injectable()
export class FavoriteRoutes {
  private router = express.Router();
  private auth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Favorite)
    private readonly favoriteController: FavoriteController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.auth = authMiddlewareService.required();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Post-based favorite actions (add/remove favorite from specific post)
    this.router.post(
      "/posts/:publicId",
      this.auth,
      new ValidationMiddleware({ params: postPublicIdSchema }).validate(),
      asyncHandler(this.favoriteController.addFavorite),
    );
    this.router.delete(
      "/posts/:publicId",
      this.auth,
      new ValidationMiddleware({ params: postPublicIdSchema }).validate(),
      asyncHandler(this.favoriteController.removeFavorite),
    );

    // User-based favorites listing (get all favorites for a user)
    this.router.get(
      "/user",
      this.auth,
      new ValidationMiddleware({ query: publicUserListQuerySchema }).validate(),
      asyncHandler(this.favoriteController.getFavorites),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
