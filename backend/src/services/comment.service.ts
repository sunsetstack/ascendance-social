import { UserPublicId, PostPublicId, asMongoId } from "@/types/branded";
import { CommentRepository } from "@/repositories/comment.repository";
import type {
  IPostReadRepository,
  IPostWriteRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";
import { IComment, TransformedComment } from "@/types";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { TOKENS } from "@/types/tokens";

// type for IPost.user that can be ObjectId or populated object
type PostUserField =
  | mongoose.Types.ObjectId
  | { _id: mongoose.Types.ObjectId; toString?: () => string };

@injectable()
export class CommentService {
  constructor(
    @inject(TOKENS.Repositories.Comment)
    private readonly commentRepository: CommentRepository,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.PostWrite)
    private readonly postWriteRepository: IPostWriteRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async createComment(
    userId: string,
    postPublicId: PostPublicId,
    content: string,
  ): Promise<TransformedComment> {
    // Validate
    if (!content.trim()) {
      throw Errors.validation("Comment content cannot be empty");
    }

    if (content.length > 500) {
      throw Errors.validation("Comment cannot exceed 500 characters");
    }

    const post = await this.postReadRepository.findByPublicId(postPublicId);
    if (!post) {
      throw Errors.notFound("Post");
    }

    let createdCommentId: string;

    await this.unitOfWork.executeInTransaction(async () => {
      // create comment
      const comment = await this.commentRepository.create({
        content: content.trim(),
        postId: post._id as mongoose.Types.ObjectId,
        userId: new mongoose.Types.ObjectId(userId),
      } as Partial<IComment>);

      createdCommentId = comment._id.toString();

      // increment comment count on post
      await this.postWriteRepository.updateCommentCount(
        asMongoId((post._id as mongoose.Types.ObjectId).toString()),
        1,
      );
    });

    // return populated comment (after commit)
    const populatedComment = await this.commentRepository.findByIdTransformed(
      createdCommentId!,
    );
    if (!populatedComment) {
      throw Errors.internal("Failed to load comment after creation");
    }
    return populatedComment;
  }

  async createCommentByPublicId(
    userPublicId: UserPublicId,
    postPublicId: PostPublicId,
    content: string,
  ) {
    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) throw Errors.notFound("User");
    return this.createComment(user.id, postPublicId, content);
  }

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

    if (content.length > 500) {
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

  async deleteComment(commentId: string, userId: string): Promise<void> {
    const comment = await this.commentRepository.findById(asMongoId(commentId));
    if (!comment) {
      throw Errors.notFound("Comment");
    }

    const post = await this.postReadRepository.findById(
      asMongoId(comment.postId.toString()),
    );
    if (!post) {
      throw Errors.notFound("Post");
    }
    const hydratedPost = await this.postReadRepository.findByPublicId(
      post.publicId,
    );
    const effectivePost = hydratedPost ?? post;

    const isCommentOwner =
      comment.userId && comment.userId.toString() === userId;
    const postOwnerInternalId = this.extractUserInternalId(effectivePost.user);
    const isPostOwner = postOwnerInternalId === userId;

    if (!isCommentOwner && !isPostOwner) {
      throw Errors.forbidden(
        "You can only delete your own comments or comments on your posts",
      );
    }

    await this.unitOfWork.executeInTransaction(async () => {
      await this.commentRepository.deleteComment(commentId);

      // decrement comment count on post
      await this.postWriteRepository.updateCommentCount(
        asMongoId(comment.postId.toString()),
        -1,
      );
    });
  }

  async deleteCommentByPublicId(commentId: string, userPublicId: UserPublicId) {
    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) throw Errors.notFound("User");
    return this.deleteComment(commentId, user.id);
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

  async getCommentsByUserId(
    userId: string,
    page: number = 1,
    limit: number = 10,
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
  ) {
    return await this.commentRepository.getCommentsByUserId(
      userId,
      page,
      limit,
      sortBy,
      sortOrder,
    );
  }

  async deleteCommentsByPostId(postId: string): Promise<number> {
    return await this.commentRepository.deleteCommentsByPostId(postId);
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

  // extracts internal user id from IPost.user which can be ObjectId or populated object
  private extractUserInternalId(user: PostUserField): string {
    if (!user) return "";
    if (user instanceof mongoose.Types.ObjectId) {
      return user.toString();
    }
    if (typeof user === "object" && "_id" in user && user._id) {
      return user._id.toString();
    }
    return "";
  }
}
