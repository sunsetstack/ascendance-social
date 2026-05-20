import express from "express";
import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { AuthController } from "../controllers/auth.controller";
import { ProfileController } from "../controllers/profile.controller";
import { SocialController } from "../controllers/social.controller";
import { UserQueryController } from "../controllers/userQuery.controller";
import {
  AuthMiddlewareService,
  forgotPasswordEmailRateLimit,
  forgotPasswordIpRateLimit,
} from "../middleware/authentication.middleware";
import { honeypotMiddleware } from "../middleware/honeypot.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import upload from "@/config/multer";
import {
  registrationSchema,
  loginSchema,
  handleSchema,
  publicIdSchema,
  updateProfileSchema,
  changePasswordSchema,
  deleteAccountSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  handleSuggestionsSchema,
  publicUserListQuerySchema,
  usersQuerySchema,
  whoToFollowQuerySchema,
} from "@/utils/schemas/user.schemas";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UserRoutes {
  private router: express.Router;
  private auth: RequestHandler;
  private optionalAuth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Auth)
    private readonly authController: AuthController,
    @inject(TOKENS.Controllers.Profile)
    private readonly profileController: ProfileController,
    @inject(TOKENS.Controllers.Social)
    private readonly socialController: SocialController,
    @inject(TOKENS.Controllers.UserQuery)
    private readonly userQueryController: UserQueryController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = express.Router();
    this.auth = authMiddlewareService.required();
    this.optionalAuth = authMiddlewareService.optional();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // === Public Routes (no authentication required) ===

    // Authentication endpoints
    this.router.post(
      "/register",
      honeypotMiddleware,
      new ValidationMiddleware({ body: registrationSchema }).validate(),
      asyncHandler(this.authController.register),
    );

    this.router.post(
      "/login",
      honeypotMiddleware,
      new ValidationMiddleware({ body: loginSchema }).validate(),
      asyncHandler(this.authController.login),
    );

    this.router.post("/logout", asyncHandler(this.authController.logout));
    this.router.post("/refresh", asyncHandler(this.authController.refresh));

    this.router.post(
      "/forgot-password",
      forgotPasswordIpRateLimit,
      honeypotMiddleware,
      new ValidationMiddleware({ body: requestPasswordResetSchema }).validate(),
      forgotPasswordEmailRateLimit,
      asyncHandler(this.authController.requestPasswordReset),
    );

    this.router.post(
      "/reset-password",
      new ValidationMiddleware({ body: resetPasswordSchema }).validate(),
      asyncHandler(this.authController.resetPassword),
    );

    this.router.post(
      "/verify-email",
      new ValidationMiddleware({ body: verifyEmailSchema }).validate(),
      asyncHandler(this.authController.verifyEmail),
    );

    // Public user data endpoints
    this.router.get(
      "/users",
      new ValidationMiddleware({ query: usersQuerySchema }).validate(),
      asyncHandler(this.userQueryController.getUsers),
    );

    this.router.get(
      "/suggestions/handles",
      this.optionalAuth,
      new ValidationMiddleware({ query: handleSuggestionsSchema }).validate(),
      asyncHandler(this.socialController.getHandleSuggestions),
    );

    this.router.get(
      "/profile/:handle",
      new ValidationMiddleware({ params: handleSchema }).validate(),
      asyncHandler(this.userQueryController.getUserByHandle),
    );

    this.router.get(
      "/public/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userQueryController.getUserByPublicId),
    );

    // followers/following lists (public)
    this.router.get(
      "/:publicId/followers",
      new ValidationMiddleware({ query: publicUserListQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.socialController.getFollowers),
    );

    this.router.get(
      "/:publicId/following",
      new ValidationMiddleware({ query: publicUserListQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.socialController.getFollowing),
    );

    // === Protected Routes (authentication required) ===
    this.router.use(this.auth);

    // Current user operations
    this.router.get("/me", asyncHandler(this.profileController.getMe));
    this.router.get(
      "/me/account-info",
      asyncHandler(this.profileController.getAccountInfo),
    );
    this.router.get(
      "/suggestions/who-to-follow",
      new ValidationMiddleware({ query: whoToFollowQuerySchema }).validate(),
      asyncHandler(this.socialController.getWhoToFollow),
    );
    this.router.put(
      "/me/edit",
      new ValidationMiddleware({ body: updateProfileSchema }).validate(),
      asyncHandler(this.profileController.updateProfile),
    );
    this.router.put(
      "/me/avatar",
      upload.single("avatar"),
      asyncHandler(this.profileController.updateAvatar),
    );
    this.router.put(
      "/me/cover",
      upload.single("cover"),
      asyncHandler(this.profileController.updateCover),
    );
    this.router.put(
      "/me/change-password",
      new ValidationMiddleware({ body: changePasswordSchema }).validate(),
      asyncHandler(this.profileController.changePassword),
    );

    // Social actions
    this.router.post(
      "/follow/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.socialController.followUserByPublicId),
    );

    this.router.delete(
      "/unfollow/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.socialController.unfollowUserByPublicId),
    );

    this.router.get(
      "/follows/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.socialController.checkFollowStatus),
    );

    // Post interactions
    this.router.post(
      "/like/post/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.socialController.likeActionByPublicId),
    );

    // Account deletion (requires password confirmation)
    this.router.delete(
      "/me",
      new ValidationMiddleware({ body: deleteAccountSchema }).validate(),
      asyncHandler(this.profileController.deleteMyAccount),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
