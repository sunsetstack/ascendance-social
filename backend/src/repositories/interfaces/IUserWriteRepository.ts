import { UpdateQuery } from "mongoose";
import { IUser } from "@/types";

/**
 * Write-only repository interface for user mutations
 * used by command handlers in CQRS pattern
 */
export interface IUserWriteRepository {
  // CRUD operations
  create(userData: Partial<IUser>): Promise<IUser>;
  update(id: string, updateData: UpdateQuery<IUser>): Promise<IUser | null>;
  updateByPublicId(
    publicId: string,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null>;
  delete(id: string): Promise<boolean>;

  // profile updates
  updateAvatar(userId: string, avatarUrl: string): Promise<void>;
  updateCover(userId: string, coverUrl: string): Promise<void>;

  // counter updates
  updateFollowerCount(userId: string, increment: number): Promise<void>;
  updateFollowingCount(userId: string, increment: number): Promise<void>;
}
