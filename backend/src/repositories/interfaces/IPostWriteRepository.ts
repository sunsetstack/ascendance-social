import mongoose from "mongoose";
import { IPost, PostStatus } from "@/types";
import { MongoId } from "@/types/branded";

/**
 * Write-only repository interface for post mutations
 * used by command handlers in CQRS pattern
 */
export interface IPostWriteRepository {
  // CRUD operations
  create(item: Partial<IPost>): Promise<IPost>;
  update(id: MongoId, item: Partial<IPost>): Promise<IPost | null>;
  delete(id: MongoId): Promise<boolean>;

  // counter updates
  incrementViewCount(postId: mongoose.Types.ObjectId): Promise<void>;
  updateCommentCount(postId: MongoId, increment: number): Promise<void>;
  updateLikeCount(postId: MongoId, increment: number): Promise<void>;
  updateRepostCount(postId: MongoId, increment: number): Promise<void>;
  activatePendingPost(
    postId: MongoId,
    updates: {
      image: mongoose.Types.ObjectId | null;
      tags: mongoose.Types.ObjectId[];
      slug: string;
    },
  ): Promise<IPost | null>;
  updatePostStatus(
    postId: MongoId,
    status: PostStatus,
    failureReason?: string,
  ): Promise<void>;

  // bulk operations
  deleteManyByUserId(userId: MongoId): Promise<number>;

  // author snapshot sync
  updateAuthorSnapshot(
    userObjectId: mongoose.Types.ObjectId,
    updates: {
      username?: string;
      avatarUrl?: string;
      displayName?: string;
      publicId?: string;
      handle?: string;
    },
  ): Promise<number>;
}
