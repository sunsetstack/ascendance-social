import { NextFunction, Response } from "express";
import { CommentService } from "@/services/comment.service";
import { Errors } from "@/utils/errors";
import { streamPaginatedResponse } from "@/utils/streamResponse";
import { inject, injectable } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateCommentCommand } from "@/application/commands/comments/createComment/createComment.command";
import { DeleteCommentCommand } from "@/application/commands/comments/deleteComment/deleteComment.command";
import { LikeCommentCommand } from "@/application/commands/comments/likeComment/likeComment.command";
import { TypedRequest } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import type {
  CommentIdParams,
  CommentsQuery,
  CreateCommentBody,
  UpdateCommentBody,
  UserCommentsQuery,
} from "@/utils/schemas/comment.schemas";
import type { PostPublicIdParams } from "@/utils/schemas/post.schemas";
import type { PublicIdParams as UserPublicIdParams } from "@/utils/schemas/user.schemas";

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyBody = Record<string, never>;

/**
 * Comment Controller
 * Handles HTTP requests for comment-related operations
 */
@injectable()
export class CommentController {
  constructor(
    @inject(TOKENS.Services.Comment)
    private readonly commentService: CommentService,
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
  ) {}

  createComment = async (
    req: TypedRequest<PostPublicIdParams, CreateCommentBody>,
    res: Response,
  ): Promise<void> => {
    const { postPublicId } = req.params;
    const { content, parentId } = req.body;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User authentication required");
    }

    const command = new CreateCommentCommand(
      decodedUser.publicId,
      asPostPublicId(postPublicId),
      content,
      parentId ?? null,
    );
    const comment = await this.commandBus.dispatch(command);

    res.status(201).json(comment);
  };

  getCommentsByPostId = async (
    req: TypedRequest<PostPublicIdParams, EmptyBody, CommentsQuery>,
    res: Response,
  ): Promise<void> => {
    const { postPublicId } = req.params;
    const { page, limit, parentId } = req.query;

    // Limit max comments per page to prevent abuse
    const maxLimit = Math.min(limit, 50);

    const result = await this.commentService.getCommentsByPostPublicId(
      asPostPublicId(postPublicId),
      page,
      maxLimit,
      parentId ?? null,
    );
    res.json(result);
  };

  updateComment = async (
    req: TypedRequest<CommentIdParams, UpdateCommentBody>,
    res: Response,
  ): Promise<void> => {
    const { commentId } = req.params;
    const { content } = req.body; // Already validated and sanitized by Zod middleware
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User authentication required");
    }

    const comment = await this.commentService.updateCommentByPublicId(
      commentId,
      decodedUser.publicId,
      content,
    );
    res.json(comment);
  };

  deleteComment = async (
    req: TypedRequest<CommentIdParams>,
    res: Response,
  ): Promise<void> => {
    const { commentId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User authentication required");
    }

    // Use CQRS command instead of service
    const command = new DeleteCommentCommand(commentId, decodedUser.publicId);
    await this.commandBus.dispatch(command);

    res.status(204).send(); // No content response
  };

  likeComment = async (
    req: TypedRequest<CommentIdParams>,
    res: Response,
  ): Promise<void> => {
    const { commentId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User authentication required");
    }

    const command = new LikeCommentCommand(decodedUser.publicId, commentId);
    const result = await this.commandBus.dispatch(command);
    res.status(200).json(result);
  };

  getCommentsByUserId = async (
    req: TypedRequest<UserPublicIdParams, EmptyBody, UserCommentsQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit, sortBy, sortOrder } = req.query;

    // Limit max comments per page
    const maxLimit = Math.min(limit, 100);

    const result = await this.commentService.getCommentsByUserPublicId(
      asUserPublicId(publicId),
      page,
      maxLimit,
      sortBy,
      sortOrder,
    );

    if (result.comments.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(
        res,
        result.comments,
        {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
        { arrayKey: "comments" },
      );
    } else {
      res.json(result);
    }
  };

  getCommentThread = async (
    req: TypedRequest<CommentIdParams>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { commentId } = req.params;
    const result = await this.commentService.getCommentThread(commentId);

    if (!result.comment) {
      next(Errors.notFound("Comment"));
      return;
    }

    res.json(result);
  };

  getCommentReplies = async (
    req: TypedRequest<CommentIdParams, EmptyBody, CommentsQuery>,
    res: Response,
  ): Promise<void> => {
    const { commentId } = req.params;
    const { page, limit } = req.query;

    const maxLimit = Math.min(limit, 50);

    const result = await this.commentService.getCommentReplies(
      commentId,
      page,
      maxLimit,
    );
    res.json(result);
  };
}
