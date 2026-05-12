import { Model, FilterQuery } from "mongoose";
import { BaseRepository } from "./base.repository";
import { IComment, PopulatedCommentLean, TransformedComment } from "@/types";
import { inject, injectable } from "tsyringe";
import { handleMongoError } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class CommentRepository extends BaseRepository<IComment> {
  /**
   * Initialize the repository with the injected Mongoose Comment model.
   */
  constructor(@inject(TOKENS.Models.Comment) model: Model<IComment>) {
    super(model);
  }

  /**
   * Transform a populated comment to the frontend format
   * Handles deleted comments by hiding user info and showing deletion message
   */
  private transformComment(comment: PopulatedCommentLean): TransformedComment {
    if (comment.isDeleted) {
      return {
        id: comment._id.toString(),
        content:
          comment.deletedBy === "admin"
            ? "[removed by moderator]"
            : "[deleted by user]",
        postPublicId: comment.postId?.publicId ?? "",
        parentId: comment.parentId ? comment.parentId.toString() : null,
        replyCount: comment.replyCount,
        depth: comment.depth,
        likesCount: 0,
        user: null,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        isEdited: false,
        isDeleted: true,
        deletedBy: comment.deletedBy,
      };
    }

    return {
      id: comment._id.toString(),
      content: comment.content,
      postPublicId: comment.postId?.publicId ?? "",
      parentId: comment.parentId ? comment.parentId.toString() : null,
      replyCount: comment.replyCount,
      depth: comment.depth,
      likesCount: comment.likesCount,
      user: comment.userId
        ? {
            publicId: comment.userId.publicId,
            handle: comment.userId.handle ?? "",
            username: comment.userId.username,
            avatar: comment.userId.avatar,
          }
        : null,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      isEdited: comment.isEdited,
      isDeleted: false,
      deletedBy: null,
    };
  }

  /**
   * Fetch paginated comments for a post.
   * Optionally filters by parent comment to support root comments or nested replies.
   * Returns transformed comments and pagination metadata.
   */
  async getCommentsByPostId(
    postId: string,
    page: number = 1,
    limit: number = 10,
    parentId: string | null = null,
  ): Promise<{
    comments: TransformedComment[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const safePage = Math.max(1, page);
      const safeLimit = Math.max(1, limit);
      const skip = (safePage - 1) * safeLimit;

      // Use FilterQuery for type-safe mongo query objects
      const filter: FilterQuery<IComment> = {
        postId,
        parentId: parentId || null,
      };

      const [comments, total] = await Promise.all([
        this.model
          .find(filter)
          .populate("userId", "publicId handle username avatar")
          .populate("postId", "publicId")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(safeLimit)
          .lean<PopulatedCommentLean[]>()
          .exec(), // Always call exec() to get a real Promise
        this.model.countDocuments(filter).exec(),
      ]);

      return {
        comments: comments.map((comment) => this.transformComment(comment)),
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Fetch paginated, non-deleted comments authored by a specific user.
   * Supports dynamic sorting direction and sort field.
   * Returns transformed comments and pagination metadata.
   */
  async getCommentsByUserId(
    userId: string,
    page: number = 1,
    limit: number = 10,
    sortBy: string = "createdAt",
    sortOrder: "asc" | "desc" = "desc",
  ): Promise<{
    comments: TransformedComment[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const safePage = Math.max(1, page);
      const safeLimit = Math.max(1, limit);
      const skip = (safePage - 1) * safeLimit;

      const filter: FilterQuery<IComment> = {
        userId,
        isDeleted: { $ne: true },
      };

      const [comments, total] = await Promise.all([
        this.model
          .find(filter)
          .populate("postId", "slug publicId")
          .populate("userId", "publicId handle username avatar")
          .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
          .skip(skip)
          .limit(safeLimit)
          .lean<PopulatedCommentLean[]>()
          .exec(),
        this.model.countDocuments(filter).exec(),
      ]);

      return {
        comments: comments.map((comment) => this.transformComment(comment)),
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Update a comment's content and mark it as edited.
   * Can run inside a transaction session when provided.
   * Returns the updated comment in transformed frontend format.
   */
  async updateComment(
    commentId: string,
    content: string,
  ): Promise<TransformedComment | null> {
    try {
      const session = this.getSession();
      const comment = await this.model
        .findByIdAndUpdate(
          commentId,
          { content, isEdited: true },
          { new: true, session },
        )
        .populate("userId", "publicId handle username avatar")
        .populate("postId", "publicId")
        .lean<PopulatedCommentLean>()
        .exec();

      if (!comment) return null;
      return this.transformComment(comment);
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Retrieve a single comment by id with populated relations.
   * Maps the result into the frontend-friendly transformed shape.
   */
  async findByIdTransformed(
    commentId: string,
  ): Promise<TransformedComment | null> {
    try {
      const comment = await this.model
        .findById(commentId)
        .populate("userId", "publicId handle username avatar")
        .populate("postId", "publicId")
        .lean<PopulatedCommentLean>()
        .exec();

      if (!comment) return null;
      return this.transformComment(comment);
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Increment or decrement the reply count for a comment.
   * Uses an atomic $inc operation and supports transactional sessions.
   */
  async updateReplyCount(commentId: string, delta: number): Promise<void> {
    try {
      const session = this.getSession();
      await this.model
        .updateOne(
          { _id: commentId },
          { $inc: { replyCount: delta } },
          { session },
        )
        .exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Increment or decrement the likes count for a comment.
   * Uses an atomic $inc operation and supports transactional sessions.
   */
  async updateLikesCount(commentId: string, delta: number): Promise<void> {
    try {
      const session = this.getSession();

      await this.model
        .updateOne(
          { _id: commentId },
          { $inc: { likesCount: delta } },
          { session },
        )
        .exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Permanently delete a comment document.
   * Returns the removed comment when found, or null when it does not exist.
   */
  async deleteComment(commentId: string): Promise<IComment | null> {
    try {
      const session = this.getSession();
      // Replaced 'as unknown as IComment' with native Mongoose generics
      return await this.model
        .findByIdAndDelete(commentId, { session })
        .populate("userId", "handle username avatar")
        .lean<IComment | null>()
        .exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Soft-delete a comment by marking it as deleted and anonymizing sensitive fields.
   * Preserves the record for thread integrity while hiding original author/content.
   */
  async softDeleteComment(
    commentId: string,
    deletedBy: "user" | "admin",
  ): Promise<IComment | null> {
    try {
      const session = this.getSession();
      return await this.model
        .findByIdAndUpdate(
          commentId,
          {
            $set: {
              isDeleted: true,
              deletedBy: deletedBy,
              userId: null,
              content:
                deletedBy === "admin"
                  ? "[removed by moderator]"
                  : "[deleted by user]",
              likesCount: 0,
            },
          },
          { session, new: true },
        )
        .lean<IComment | null>()
        .exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Check whether a comment has at least one direct reply.
   * Returns true if child comments exist, otherwise false.
   */
  async hasReplies(commentId: string): Promise<boolean> {
    try {
      const count = await this.model
        .countDocuments({ parentId: commentId })
        .exec();
      return count > 0;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Verify if the given user is the owner of the specified comment.
   * Useful for authorization checks before update/delete operations.
   */
  async isCommentOwner(commentId: string, userId: string): Promise<boolean> {
    try {
      const comment = await this.model
        .findById(commentId)
        .lean<{ userId?: string }>()
        .exec();
      if (!comment || !comment.userId) return false;
      return comment.userId.toString() === userId;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Hard-delete all comments associated with a post.
   * Returns the number of documents removed.
   */
  async deleteCommentsByPostId(postId: string): Promise<number> {
    try {
      const session = this.getSession();
      const result = await this.model
        .deleteMany({ postId }, { session })
        .exec();
      return result.deletedCount || 0;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Hard-delete all comments authored by a user.
   * Returns the number of documents removed.
   */
  async deleteCommentsByUserId(userId: string): Promise<number> {
    try {
      const session = this.getSession();

      const result = await this.model
        .deleteMany({ userId }, { session })
        .exec();
      return result.deletedCount || 0;
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Retrieve a comment and its ancestor chain up to the root comment.
   * Ancestors are returned in root-to-parent order for easier breadcrumb rendering.
   */
  async getCommentWithAncestors(commentId: string): Promise<{
    comment: TransformedComment | null;
    ancestors: TransformedComment[];
  }> {
    try {
      const comment = await this.findByIdTransformed(commentId);
      if (!comment) return { comment: null, ancestors: [] };

      const ancestors: TransformedComment[] = [];
      let currentParentId = comment.parentId;

      // Note: If comments can be deeply nested, this N+1 query loop might become a bottleneck.
      // Consider an aggregation pipeline with $graphLookup for production scale.
      while (currentParentId) {
        const parent = await this.findByIdTransformed(currentParentId);
        if (!parent) break;
        ancestors.push(parent);
        currentParentId = parent.parentId;
      }

      ancestors.reverse();
      return { comment, ancestors };
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Fetch paginated direct replies for a specific parent comment.
   * Returns transformed replies and pagination metadata.
   */
  async getCommentReplies(
    commentId: string,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    comments: TransformedComment[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    try {
      const safePage = Math.max(1, page);
      const safeLimit = Math.max(1, limit);
      const skip = (safePage - 1) * safeLimit;

      const [comments, total] = await Promise.all([
        this.model
          .find({ parentId: commentId })
          .populate("userId", "publicId handle username avatar")
          .populate("postId", "publicId")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(safeLimit)
          .lean<PopulatedCommentLean[]>()
          .exec(),
        this.model.countDocuments({ parentId: commentId }).exec(),
      ]);

      return {
        comments: comments.map((comment) => this.transformComment(comment)),
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      };
    } catch (error) {
      handleMongoError(error);
    }
  }
}
