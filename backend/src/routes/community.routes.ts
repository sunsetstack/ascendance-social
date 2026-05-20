import express from "express";
import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { inject, injectable } from "tsyringe";
import { CommunityController } from "../controllers/community.controller";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import {
  createCommunitySchema,
  communityPaginationQuerySchema,
  updateCommunitySchema,
  communityPublicIdSchema,
  communitySlugSchema,
  kickMemberSchema,
  communitySearchSchema,
} from "@/utils/schemas/community.schemas";
import upload from "@/config/multer";
import { TOKENS } from "@/types/tokens";

@injectable()
export class CommunityRoutes {
  private readonly router = express.Router();
  private readonly auth: RequestHandler;
  private readonly optionalAuth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Community)
    private readonly communityController: CommunityController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.auth = authMiddlewareService.required();
    this.optionalAuth = authMiddlewareService.optional();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // Get All Communities
    this.router.get(
      "/",
      this.optionalAuth,
      new ValidationMiddleware({ query: communitySearchSchema }).validate(),
      asyncHandler(this.communityController.getAllCommunities),
    );

    // Create Community
    this.router.post(
      "/",
      this.auth,
      upload.single("avatar"),
      new ValidationMiddleware({ body: createCommunitySchema }).validate(),
      asyncHandler(this.communityController.createCommunity),
    );

    // Get User Communities (My Communities)
    this.router.get(
      "/me",
      this.auth,
      new ValidationMiddleware({
        query: communityPaginationQuerySchema,
      }).validate(),
      asyncHandler(this.communityController.getUserCommunities),
    );

    // Join Community
    this.router.post(
      "/:id/join",
      this.auth,
      new ValidationMiddleware({ params: communityPublicIdSchema }).validate(),
      asyncHandler(this.communityController.joinCommunity),
    );

    // Leave Community
    this.router.post(
      "/:id/leave",
      this.auth,
      new ValidationMiddleware({ params: communityPublicIdSchema }).validate(),
      asyncHandler(this.communityController.leaveCommunity),
    );

    // Get Community Feed
    this.router.get(
      "/:id/feed",
      this.optionalAuth,
      new ValidationMiddleware({
        query: communityPaginationQuerySchema,
      }).validate(),
      new ValidationMiddleware({ params: communityPublicIdSchema }).validate(),
      asyncHandler(this.communityController.getCommunityFeed),
    );

    // Get Community Members
    this.router.get(
      "/:slug/members",
      this.optionalAuth,
      new ValidationMiddleware({
        query: communityPaginationQuerySchema,
      }).validate(),
      new ValidationMiddleware({ params: communitySlugSchema }).validate(),
      asyncHandler(this.communityController.getCommunityMembers),
    );

    // Get Community Details (by slug)
    this.router.get(
      "/:slug",
      this.optionalAuth,
      new ValidationMiddleware({ params: communitySlugSchema }).validate(),
      asyncHandler(this.communityController.getCommunityDetails),
    );

    // Update Community
    this.router.patch(
      "/:id",
      this.auth,
      upload.fields([
        { name: "avatar", maxCount: 1 },
        { name: "coverPhoto", maxCount: 1 },
      ]),
      new ValidationMiddleware({
        params: communityPublicIdSchema,
        body: updateCommunitySchema,
      }).validate(),
      asyncHandler(this.communityController.updateCommunity),
    );

    // Delete Community
    this.router.delete(
      "/:id",
      this.auth,
      new ValidationMiddleware({ params: communityPublicIdSchema }).validate(),
      asyncHandler(this.communityController.deleteCommunity),
    );

    // Kick Member
    this.router.delete(
      "/:id/members/:userId",
      this.auth,
      new ValidationMiddleware({ params: kickMemberSchema }).validate(),
      asyncHandler(this.communityController.kickMember),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
