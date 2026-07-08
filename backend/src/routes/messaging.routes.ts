import express from "express";
import { RequestHandler } from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { inject, injectable } from "tsyringe";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { MessagingController } from "../controllers/messaging.controller";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import upload, { validateImageUpload } from "../config/multer";
import { TOKENS } from "@/types/tokens";
import {
  paginationSchema,
  conversationParamsSchema,
  initiateConversationSchema,
  sendMessageSchema,
  messageParamsSchema,
  editMessageSchema,
} from "@/utils/schemas/messaging.schemas";

@injectable()
export class MessagingRoutes {
  private readonly router: express.Router;
  private readonly auth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Messaging)
    private readonly messagingController: MessagingController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = express.Router();
    this.auth = authMiddlewareService.required();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.use(this.auth);

    this.router.get(
      "/conversations",
      new ValidationMiddleware({ query: paginationSchema }).validate(),
      asyncHandler(this.messagingController.listConversations),
    );

    this.router.get(
      "/conversations/:conversationId/messages",
      new ValidationMiddleware({
        params: conversationParamsSchema,
        query: paginationSchema,
      }).validate(),
      asyncHandler(this.messagingController.getConversationMessages),
    );

    this.router.post(
      "/conversations/initiate",
      new ValidationMiddleware({ body: initiateConversationSchema }).validate(),
      asyncHandler(this.messagingController.initiateConversation),
    );

    this.router.post(
      "/conversations/:conversationId/read",
      new ValidationMiddleware({ params: conversationParamsSchema }).validate(),
      asyncHandler(this.messagingController.markConversationRead),
    );

    this.router.post(
      "/messages",
      upload.single("image"),
      validateImageUpload,
      // Note: validation middleware for body might fail if multipart form data is used and body is not JSON.
      // Multer parses body. ValidationMiddleware should handle parsed body.
      new ValidationMiddleware({ body: sendMessageSchema }).validate(),
      asyncHandler(this.messagingController.sendMessage),
    );

    this.router.patch(
      "/messages/:messageId",
      new ValidationMiddleware({
        params: messageParamsSchema,
        body: editMessageSchema,
      }).validate(),
      asyncHandler(this.messagingController.editMessage),
    );

    this.router.delete(
      "/messages/:messageId",
      new ValidationMiddleware({ params: messageParamsSchema }).validate(),
      asyncHandler(this.messagingController.deleteMessage),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
