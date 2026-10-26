import express, { type RequestHandler } from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { inject, injectable } from "tsyringe";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { MessagingController } from "../controllers/messaging.controller";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import upload from "../config/multer";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import {
  paginationSchema,
  conversationParamsSchema,
  initiateConversationSchema,
  sendMessageSchema,
  messageParamsSchema,
  editMessageSchema,
} from "@/utils/schemas/messaging.schemas";

const parseMessageBody: RequestHandler = (req, res, next) => {
  upload.none()(req, res, (error) => {
    if (error) {
      return next(
        Errors.validation("Message attachments are not supported", {
          cause: error,
        }),
      );
    }
    next();
  });
};

@injectable()
export class MessagingRoutes {
  private readonly router: express.Router;
  private readonly auth: RequestHandler;
  private readonly adminOnly: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Messaging)
    private readonly messagingController: MessagingController,
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

    this.router.delete(
      "/conversations/:conversationId",
      new ValidationMiddleware({ params: conversationParamsSchema }).validate(),
      asyncHandler(this.messagingController.deleteConversation),
    );
    this.router.delete(
      "/conversations/:conversationId/purge",
      this.adminOnly,
      new ValidationMiddleware({ params: conversationParamsSchema }).validate(),
      asyncHandler(this.messagingController.purgeConversation),
    );
    this.router.post(
      "/conversations/:conversationId/lock",
      this.adminOnly,
      new ValidationMiddleware({ params: conversationParamsSchema }).validate(),
      asyncHandler(this.messagingController.lockConversation),
    );
    this.router.delete(
      "/conversations/:conversationId/lock",
      this.adminOnly,
      new ValidationMiddleware({ params: conversationParamsSchema }).validate(),
      asyncHandler(this.messagingController.unlockConversation),
    );

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
      parseMessageBody,
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
