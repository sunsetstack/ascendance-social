import express from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { UserController } from "../controllers/user.controller";
import {
  AuthFactory,
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
  private auth = AuthFactory.bearerToken().handle();
  private optionalAuth = AuthFactory.optionalBearerToken().handleOptional();

  constructor(
    @inject(TOKENS.Controllers.User)
    private readonly userController: UserController,
  ) {
    this.router = express.Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    // === Public Routes (no authentication required) ===

    // Authentication endpoints
    this.router.post(
      "/register",
      honeypotMiddleware,
      new ValidationMiddleware({ body: registrationSchema }).validate(),
      asyncHandler(this.userController.register),
    );

    this.router.post(
      "/login",
      honeypotMiddleware,
      new ValidationMiddleware({ body: loginSchema }).validate(),
      asyncHandler(this.userController.login),
    );

    this.router.post("/logout", asyncHandler(this.userController.logout));
    this.router.post("/refresh", asyncHandler(this.userController.refresh));

    this.router.post(
      "/forgot-password",
      forgotPasswordIpRateLimit,
      honeypotMiddleware,
      new ValidationMiddleware({ body: requestPasswordResetSchema }).validate(),
      forgotPasswordEmailRateLimit,
      asyncHandler(this.userController.requestPasswordReset),
    );

    this.router.post(
      "/reset-password",
      new ValidationMiddleware({ body: resetPasswordSchema }).validate(),
      asyncHandler(this.userController.resetPassword),
    );

    this.router.post(
      "/verify-email",
      new ValidationMiddleware({ body: verifyEmailSchema }).validate(),
      asyncHandler(this.userController.verifyEmail),
    );

    // Public user data endpoints
    this.router.get(
      "/users",
      new ValidationMiddleware({ query: usersQuerySchema }).validate(),
      asyncHandler(this.userController.getUsers),
    );

    this.router.get(
      "/suggestions/handles",
      this.optionalAuth,
      new ValidationMiddleware({ query: handleSuggestionsSchema }).validate(),
      asyncHandler(this.userController.getHandleSuggestions),
    );

    this.router.get(
      "/profile/:handle",
      new ValidationMiddleware({ params: handleSchema }).validate(),
      asyncHandler(this.userController.getUserByHandle),
    );

    this.router.get(
      "/public/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.getUserByPublicId),
    );

    // followers/following lists (public)
    this.router.get(
      "/:publicId/followers",
      new ValidationMiddleware({ query: publicUserListQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.getFollowers),
    );

    this.router.get(
      "/:publicId/following",
      new ValidationMiddleware({ query: publicUserListQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.getFollowing),
    );

    // === Protected Routes (authentication required) ===
    this.router.use(this.auth);

    // Current user operations
    this.router.get("/me", asyncHandler(this.userController.getMe));
    this.router.get(
      "/me/account-info",
      asyncHandler(this.userController.getAccountInfo),
    );
    this.router.get(
      "/suggestions/who-to-follow",
      new ValidationMiddleware({ query: whoToFollowQuerySchema }).validate(),
      asyncHandler(this.userController.getWhoToFollow),
    );
    this.router.put(
      "/me/edit",
      new ValidationMiddleware({ body: updateProfileSchema }).validate(),
      asyncHandler(this.userController.updateProfile),
    );
    this.router.put(
      "/me/avatar",
      upload.single("avatar"),
      asyncHandler(this.userController.updateAvatar),
    );
    this.router.put(
      "/me/cover",
      upload.single("cover"),
      asyncHandler(this.userController.updateCover),
    );
    this.router.put(
      "/me/change-password",
      new ValidationMiddleware({ body: changePasswordSchema }).validate(),
      asyncHandler(this.userController.changePassword),
    );

    // Social actions
    this.router.post(
      "/follow/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.followUserByPublicId),
    );

    this.router.delete(
      "/unfollow/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.unfollowUserByPublicId),
    );

    this.router.get(
      "/follows/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.checkFollowStatus),
    );

    // Post interactions
    this.router.post(
      "/like/post/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.userController.likeActionByPublicId),
    );

    // Account deletion (requires password confirmation)
    this.router.delete(
      "/me",
      new ValidationMiddleware({ body: deleteAccountSchema }).validate(),
      asyncHandler(this.userController.deleteMyAccount),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
