import { UserPublicId, PostPublicId, asMongoId } from "@/types/branded";
import { CommentRepository } from "@/repositories/comment.repository";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import { TransformedComment } from "@/types";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";
import { sanitizedTextLength } from "@/utils/sanitizers";

@injectable()
export class CommentService {
  constructor(
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async getCommentsByPostPublicId(
    postPublicId: PostPublicId,
    page: number = 1,
    limit: number = 10,
    parentId: string | null = null,
  ) {
    // Validate post exists
    const post = await this.postReadRepository.findByPublicId(postPublicId);
    if (!post) {
      throw Errors.notFound("Post");
    }

    return await this.commentRepository.getCommentsByPostId(
      asMongoId((post._id as mongoose.Types.ObjectId).toString()),
      page,
      limit,
      parentId,
    );
  }

  async updateComment(
    commentId: string,
    userId: string,
    content: string,
    isAdmin: boolean = false,
  ): Promise<TransformedComment> {
    // Validate input
    if (!content.trim()) {
      throw Errors.validation("Comment content cannot be empty");
    }

    if (sanitizedTextLength(content) > 500) {
      throw Errors.validation("Comment cannot exceed 500 characters");
    }

    // Check if comment exists and user owns it
    const isOwner = await this.commentRepository.isCommentOwner(
      commentId,
      userId,
    );
    if (!isOwner && !isAdmin) {
      throw Errors.forbidden("You can only edit your own comments");
    }

    let updatedComment: TransformedComment | null = null;

    await this.unitOfWork.executeInTransaction(async () => {
      updatedComment = await this.commentRepository.updateComment(
        commentId,
        content.trim(),
      );

      if (!updatedComment) {
        throw Errors.notFound("Comment");
      }
    });

    return updatedComment!;
  }

  async updateCommentByPublicId(
    commentId: string,
    userPublicId: UserPublicId,
    content: string,
  ) {
    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) throw Errors.notFound("User");
    return this.updateComment(commentId, user.id, content, user.isAdmin);
  }

  async getCommentsByUserPublicId(
    userPublicId: UserPublicId,
    page: number = 1,
    limit: number = 10,
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
  ) {
    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) {
      throw Errors.notFound("User");
    }
    return await this.commentRepository.getCommentsByUserId(
      user.id,
      page,
      limit,
      sortBy,
      sortOrder,
    );
  }

  /**
   * Get a single comment with its ancestor chain
   */
  async getCommentThread(commentId: string) {
    return await this.commentRepository.getCommentWithAncestors(commentId);
  }

  /**
   * Get direct replies to a comment
   */
  async getCommentReplies(
    commentId: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const comment = await this.commentRepository.findById(asMongoId(commentId));
    if (!comment) {
      throw Errors.notFound("Comment");
    }
    return await this.commentRepository.getCommentReplies(
      commentId,
      page,
      limit,
    );
  }
}
