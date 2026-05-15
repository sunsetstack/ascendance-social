import { UpdateQuery } from "mongoose";
import { IUser } from "@/types";
import { MongoId, UserPublicId } from "@/types/branded";

/**
 * Write-only repository interface for user mutations
 * used by command handlers in CQRS pattern
 */
export interface IUserWriteRepository {
  // CRUD operations
  create(userData: Partial<IUser>): Promise<IUser>;
  update(id: MongoId, updateData: UpdateQuery<IUser>): Promise<IUser | null>;
  updateByPublicId(
    publicId: UserPublicId,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null>;
  delete(id: MongoId): Promise<boolean>;

  // profile updates
  updateAvatar(userId: MongoId, avatarUrl: string): Promise<void>;
  updateCover(userId: MongoId, coverUrl: string): Promise<void>;

  // counter updates
  updateFollowerCount(userId: MongoId, increment: number): Promise<void>;
  updateFollowingCount(userId: MongoId, increment: number): Promise<void>;
}
