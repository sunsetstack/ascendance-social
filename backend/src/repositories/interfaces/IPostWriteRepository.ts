import mongoose from "mongoose";
import { IPost, PostStatus } from "@/types";
import { MongoId, PostPublicId } from "@/types/branded";
import type { ContentFeatures } from "@/services/feed/interests.policy";

export type AuthorSnapshot = Pick<IPost["author"], "publicId" | "handle" | "username"> & {
  avatarUrl: string;
  displayName: string;
};

/**
 * Write-only repository interface for post mutations
 * used by command handlers in CQRS
 */
export interface IPostWriteRepository {
  // CRUD operations
  create(item: Partial<IPost>): Promise<IPost>;
  update(id: MongoId, item: Partial<IPost>): Promise<IPost | null>;
  delete(id: MongoId): Promise<boolean>;

  // counter updates
  incrementViewCount(postId: mongoose.Types.ObjectId): Promise<void>;
  updateCommentCount(postId: MongoId, increment: number): Promise<void>;
  updateLikeCount(postId: MongoId, increment: number): Promise<boolean>;
  updateRepostCount(postId: MongoId, increment: number): Promise<void>;
  activatePendingPost(
    postId: MongoId,
    updates: {
      image: mongoose.Types.ObjectId | null;
      tags: mongoose.Types.ObjectId[];
      slug: string;
      contentFeatures?: ContentFeatures;
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
    snapshot: AuthorSnapshot,
    profileRevision: number,
    postPublicId?: PostPublicId,
  ): Promise<number>;
}
