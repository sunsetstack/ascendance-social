import {
  IUser,
  PaginationOptions,
  PaginationResult,
  UserSuggestion,
} from "@/types";
import { MongoId, UserPublicId } from "@/types/branded";

/**
 * Read-only repository interface for user queries
 * used by query handlers in CQRS pattern
 */
export interface IUserReadRepository {
  // single user lookups
  findById(id: MongoId): Promise<IUser | null>;
  findByPublicId(publicId: UserPublicId): Promise<IUser | null>;
  findInternalIdByPublicId(publicId: UserPublicId): Promise<MongoId | null>;
  findByUsername(username: string): Promise<IUser | null>;
  findByHandle(handle: string): Promise<IUser | null>;
  findByEmail(email: string): Promise<IUser | null>;
  findByResetToken(token: string): Promise<IUser | null>;
  findByEmailVerificationToken(
    email: string,
    token: string,
  ): Promise<IUser | null>;

  // batch lookups
  findUsersByPublicIds(userPublicIds: UserPublicId[]): Promise<IUser[]>;
  findUsersByUsernames(usernames: string[]): Promise<IUser[]>;
  findUsersByHandles(handles: string[]): Promise<IUser[]>;
  findUsersFollowing(userPublicId: UserPublicId): Promise<IUser[]>;

  // paginated queries
  getAll(options: {
    search?: string[];
    page?: number;
    limit?: number;
  }): Promise<IUser[] | null>;
  findWithPagination(
    options: PaginationOptions,
  ): Promise<PaginationResult<IUser>>;

  // counts
  countDocuments(filter: Record<string, unknown>): Promise<number>;

  // suggestions and recommendations
  getSuggestedUsersToFollow(
    currentUserId: MongoId,
    limit?: number,
  ): Promise<UserSuggestion[]>;
  getSuggestedUsersLowTraffic(
    currentUserId: MongoId,
    limit?: number,
    recentlyActiveUserPublicIds?: UserPublicId[],
  ): Promise<UserSuggestion[]>;
  getSuggestedUsersHighTraffic(
    currentUserId: MongoId,
    limit?: number,
  ): Promise<UserSuggestion[]>;
}
