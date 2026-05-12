import { IUser, PaginationOptions, PaginationResult, UserSuggestion } from "@/types";

/**
 * Read-only repository interface for user queries
 * used by query handlers in CQRS pattern
 */
export interface IUserReadRepository {
	// single user lookups
	findById(id: string): Promise<IUser | null>;
	findByPublicId(publicId: string): Promise<IUser | null>;
	findInternalIdByPublicId(publicId: string): Promise<string | null>;
	findByUsername(username: string): Promise<IUser | null>;
	findByHandle(handle: string): Promise<IUser | null>;
	findByEmail(email: string): Promise<IUser | null>;
	findByResetToken(token: string): Promise<IUser | null>;
	findByEmailVerificationToken(email: string, token: string): Promise<IUser | null>;

	// batch lookups
	findUsersByPublicIds(userPublicIds: string[]): Promise<IUser[]>;
	findUsersByUsernames(usernames: string[]): Promise<IUser[]>;
	findUsersByHandles(handles: string[]): Promise<IUser[]>;
	findUsersFollowing(userPublicId: string): Promise<IUser[]>;

	// paginated queries
	getAll(options: { search?: string[]; page?: number; limit?: number }): Promise<IUser[] | null>;
	findWithPagination(options: PaginationOptions): Promise<PaginationResult<IUser>>;

	// counts
	countDocuments(filter: Record<string, unknown>): Promise<number>;

	// suggestions and recommendations
	getSuggestedUsersToFollow(currentUserId: string, limit?: number): Promise<UserSuggestion[]>;
	getSuggestedUsersLowTraffic(
		currentUserId: string,
		limit?: number,
		recentlyActiveUserPublicIds?: string[],
	): Promise<UserSuggestion[]>;
	getSuggestedUsersHighTraffic(currentUserId: string, limit?: number): Promise<UserSuggestion[]>;
}
