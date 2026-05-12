import express from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { CommentController } from "../controllers/comment.controller";
import { AuthFactory } from "../middleware/authentication.middleware";
import { inject, injectable } from "tsyringe";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import {
  createCommentSchema,
  updateCommentSchema,
  commentIdSchema,
  commentsQuerySchema,
  userCommentsQuerySchema,
} from "@/utils/schemas/comment.schemas";
import { postPublicIdSchema } from "@/utils/schemas/post.schemas";
import { publicIdSchema as userPublicIdSchema } from "@/utils/schemas/user.schemas";
import { TOKENS } from "@/types/tokens";

@injectable()
export class CommentRoutes {
  private router = express.Router();
  private auth = AuthFactory.bearerToken().handle();

  constructor(
    @inject(TOKENS.Controllers.Comment)
    private readonly commentController: CommentController,
  ) {
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(
      "/comments/:commentId/replies",
      new ValidationMiddleware({
        params: commentIdSchema,
        query: commentsQuerySchema,
      }).validate(),
      asyncHandler(this.commentController.getCommentReplies),
    );

    // User comments
    this.router.get(
      "/users/:publicId/comments",
      new ValidationMiddleware({ query: userCommentsQuerySchema }).validate(),
      new ValidationMiddleware({ params: userPublicIdSchema }).validate(),
      asyncHandler(this.commentController.getCommentsByUserId),
    );

    this.router.get(
      "/posts/:postPublicId/comments",
      new ValidationMiddleware({
        params: postPublicIdSchema,
        query: commentsQuerySchema,
      }).validate(),
      asyncHandler(this.commentController.getCommentsByPostId),
    );

    // Comment thread view
    this.router.get(
      "/comments/:commentId/thread",
      new ValidationMiddleware({ params: commentIdSchema }).validate(),
      asyncHandler(this.commentController.getCommentThread),
    );

    // Comment management
    this.router.put(
      "/comments/:commentId",
      this.auth,
      new ValidationMiddleware({
        params: commentIdSchema,
        body: updateCommentSchema,
      }).validate(),
      asyncHandler(this.commentController.updateComment),
    );

    this.router.post(
      "/comments/:commentId/like",
      this.auth,
      new ValidationMiddleware({ params: commentIdSchema }).validate(),
      asyncHandler(this.commentController.likeComment),
    );

    this.router.delete(
      "/comments/:commentId",
      this.auth,
      new ValidationMiddleware({ params: commentIdSchema }).validate(),
      asyncHandler(this.commentController.deleteComment),
    );

    this.router.post(
      "/posts/:postPublicId/comments",
      this.auth,
      new ValidationMiddleware({
        params: postPublicIdSchema,
        body: createCommentSchema,
      }).validate(),
      asyncHandler(this.commentController.createComment),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
