import express from "express";
import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { AdminUserController } from "../controllers/admin.controller";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import {
  adminRateLimit,
  AuthMiddlewareService,
} from "../middleware/authentication.middleware";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  adminFavoriteParamsSchema,
  adminDeleteUserBodySchema,
  adminImagesQuerySchema,
  adminUsersQuerySchema,
  authActivityLogsQuerySchema,
  banUserBodySchema,
  cacheClearQuerySchema,
  recentActivityQuerySchema,
  requestLogsQuerySchema,
} from "@/utils/schemas/admin.schemas";
import { commentIdSchema } from "@/utils/schemas/comment.schemas";
import { publicIdSchema as postPublicIdSchema } from "@/utils/schemas/post.schemas";
import { publicIdSchema as userPublicIdSchema } from "@/utils/schemas/user.schemas";

@injectable()
export class AdminUserRoutes {
  private router: express.Router;
  private auth: RequestHandler;
  private adminOnly: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.AdminUser)
    private readonly adminUserController: AdminUserController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = express.Router();
    this.auth = authMiddlewareService.required();
    this.adminOnly = authMiddlewareService.adminOnly();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.use(this.auth);
    this.router.use(adminRateLimit);
    this.router.use(this.adminOnly);

    // ===Admin endpoints===

    //Get all users
    this.router.get(
      "/",
      new ValidationMiddleware({ query: adminUsersQuerySchema }).validate(),
      asyncHandler(this.adminUserController.getAllUsersAdmin),
    );

    //Get user by public ID
    this.router.get(
      "/user/:publicId",
      new ValidationMiddleware({ params: userPublicIdSchema }).validate(),
      asyncHandler(this.adminUserController.getUser),
    );

    //Delete a user by public ID
    this.router.delete(
      "/user/:publicId",
      new ValidationMiddleware({
        params: userPublicIdSchema,
        body: adminDeleteUserBodySchema,
      }).validate(),
      asyncHandler(this.adminUserController.deleteUser),
    );

    //Delete an image by public ID
    this.router.delete(
      "/image/:publicId",
      new ValidationMiddleware({ params: postPublicIdSchema }).validate(),
      asyncHandler(this.adminUserController.deleteImage),
    );

    //Delete a comment by ID
    this.router.delete(
      "/comment/:commentId",
      new ValidationMiddleware({ params: commentIdSchema }).validate(),
      asyncHandler(this.adminUserController.deleteComment),
    );

    //Remove a favorite from a user
    this.router.delete(
      "/user/:publicId/favorite/:postPublicId",
      new ValidationMiddleware({
        params: adminFavoriteParamsSchema,
      }).validate(),
      asyncHandler(this.adminUserController.removeUserFavorite),
    );

    // ===New Admin endpoints===

    // User management
    this.router.get(
      "/user/:publicId/stats",
      new ValidationMiddleware({ params: userPublicIdSchema }).validate(),
      asyncHandler(this.adminUserController.getUserStats),
    );
    this.router.put(
      "/user/:publicId/ban",
      new ValidationMiddleware({
        params: userPublicIdSchema,
        body: banUserBodySchema,
      }).validate(),
      asyncHandler(this.adminUserController.banUser),
    );
    this.router.put(
      "/user/:publicId/unban",
      new ValidationMiddleware({ params: userPublicIdSchema }).validate(),
      asyncHandler(this.adminUserController.unbanUser),
    );
    this.router.put(
      "/user/:publicId/promote",
      new ValidationMiddleware({ params: userPublicIdSchema }).validate(),
      asyncHandler(this.adminUserController.promoteToAdmin),
    );
    this.router.put(
      "/user/:publicId/demote",
      new ValidationMiddleware({ params: userPublicIdSchema }).validate(),
      asyncHandler(this.adminUserController.demoteFromAdmin),
    );

    // Image management
    this.router.get(
      "/images",
      new ValidationMiddleware({ query: adminImagesQuerySchema }).validate(),
      asyncHandler(this.adminUserController.getAllImages),
    );

    // Dashboard and analytics
    this.router.get(
      "/dashboard/stats",
      asyncHandler(this.adminUserController.getDashboardStats),
    );
    this.router.get(
      "/dashboard/activity",
      new ValidationMiddleware({ query: recentActivityQuerySchema }).validate(),
      asyncHandler(this.adminUserController.getRecentActivity),
    );
    this.router.get(
      "/dashboard/request-logs",
      new ValidationMiddleware({ query: requestLogsQuerySchema }).validate(),
      asyncHandler(this.adminUserController.getRequestLogs),
    );

    this.router.get(
      "/dashboard/auth-activity",
      new ValidationMiddleware({ query: authActivityLogsQuerySchema }).validate(),
      asyncHandler(this.adminUserController.getAuthActivityLogs),
    );

    // Cache management
    this.router.delete(
      "/cache",
      new ValidationMiddleware({ query: cacheClearQuerySchema }).validate(),
      asyncHandler(this.adminUserController.clearCache),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
