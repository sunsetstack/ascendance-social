import { NotificationController } from "../controllers/notification.controller";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import express from "express";
import { RequestHandler } from "express";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  notificationIdSchema,
  notificationQuerySchema,
} from "@/utils/schemas/notification.schemas";

@injectable()
export class NotificationRoutes {
  public router: express.Router;
  private auth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Notification)
    private controller: NotificationController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = express.Router();
    this.auth = authMiddlewareService.required();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    const protectedRouter = express.Router();
    protectedRouter.use(this.auth);
    protectedRouter.get(
      "/",
      new ValidationMiddleware({ query: notificationQuerySchema }).validate(),
      asyncHandler(this.controller.getNotifications),
    );
    protectedRouter.get(
      "/unread-count",
      asyncHandler(this.controller.getUnreadCount),
    );
    protectedRouter.post(
      "/read/:notificationId",
      new ValidationMiddleware({ params: notificationIdSchema }).validate(),
      asyncHandler(this.controller.markAsRead),
    );
    protectedRouter.post(
      "/read-all",
      asyncHandler(this.controller.markAllAsRead),
    );
    this.router.use(protectedRouter);
  }

  getRouter() {
    return this.router;
  }
}
