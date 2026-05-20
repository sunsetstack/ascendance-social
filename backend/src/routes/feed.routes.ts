import { FeedController } from "../controllers/feed.controller";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import express from "express";
import { RequestHandler } from "express";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  feedPaginationQuerySchema,
  newFeedQuerySchema,
  trendingTagsQuerySchema,
} from "@/utils/schemas/feed.schemas";

@injectable()
export class FeedRoutes {
  public router: express.Router;
  private auth: RequestHandler;
  private optionalAuth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Feed) private controller: FeedController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = express.Router();
    this.auth = authMiddlewareService.required();
    this.optionalAuth = authMiddlewareService.optional();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(
      "/",
      this.auth,
      new ValidationMiddleware({ query: feedPaginationQuerySchema }).validate(),
      asyncHandler(this.controller.getFeed),
    );
    this.router.get(
      "/for-you",
      this.auth,
      new ValidationMiddleware({ query: feedPaginationQuerySchema }).validate(),
      asyncHandler(this.controller.getForYouFeed),
    );
    this.router.get(
      "/trending",
      new ValidationMiddleware({ query: feedPaginationQuerySchema }).validate(),
      asyncHandler(this.controller.getTrendingFeed),
    );
    this.router.get(
      "/new",
      this.optionalAuth,
      new ValidationMiddleware({ query: newFeedQuerySchema }).validate(),
      asyncHandler(this.controller.getNewFeed),
    );
    this.router.get(
      "/trending-tags",
      new ValidationMiddleware({ query: trendingTagsQuerySchema }).validate(),
      asyncHandler(this.controller.getTrendingTags),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
