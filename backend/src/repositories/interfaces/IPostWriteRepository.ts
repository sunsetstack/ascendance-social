import mongoose from "mongoose";
import { IPost } from "@/types";

/**
 * Write-only repository interface for post mutations
 * used by command handlers in CQRS pattern
 */
export interface IPostWriteRepository {
	// CRUD operations
	create(item: Partial<IPost>): Promise<IPost>;
	update(id: string, item: Partial<IPost>): Promise<IPost | null>;
	delete(id: string): Promise<boolean>;

	// counter updates
	incrementViewCount(postId: mongoose.Types.ObjectId): Promise<void>;
	updateCommentCount(postId: string, increment: number): Promise<void>;
	updateLikeCount(postId: string, increment: number): Promise<void>;
	updateRepostCount(postId: string, increment: number): Promise<void>;

	// bulk operations
	deleteManyByUserId(userId: string): Promise<number>;

	// author snapshot sync
	updateAuthorSnapshot(
		userObjectId: mongoose.Types.ObjectId,
		updates: {
			username?: string;
			avatarUrl?: string;
			displayName?: string;
			publicId?: string;
			handle?: string;
		}
	): Promise<number>;
}
