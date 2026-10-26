import { injectable } from "tsyringe";
import { Types } from "mongoose";
import PostView from "@/models/postView.model";
import { BaseRepository } from "./base.repository";
import { IPostView } from "@/types";
import { Errors } from "@/utils/errors";

@injectable()
export class PostViewRepository extends BaseRepository<IPostView> {
	constructor() {
		super(PostView);
	}

	/**
	 * Record a view for a post by an authenticated user
	 * Returns true if a new view was recorded or false if user already viewed
	 */
	async recordView(postId: Types.ObjectId, userId: Types.ObjectId): Promise<boolean> {
		const session = this.getSession();
		try {
			const viewData: Partial<IPostView> = {
				post: postId,
				user: userId,
				viewedAt: new Date(),
			};

			const result = await this.model.updateOne(
				{ post: postId, user: userId },
				{ $setOnInsert: viewData },
				{ upsert: true, session },
			);
			return result.upsertedCount === 1;
		} catch (error: unknown) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
				// Duplicate writes abort a transaction; its owner must handle the error.
				if (session) throw error;
				return false;
			}
			throw Errors.database("Failed to record post view", { cause: error });
		}
	}

	/**
	 * Check if a user has viewed a post
	 */
	async hasViewed(postId: Types.ObjectId, userId: Types.ObjectId): Promise<boolean> {
		try {
			const session = this.getSession();
			const view = await this.model.findOne({ post: postId, user: userId }).session(session || null);
			return !!view;
		} catch (error: unknown) {
			throw Errors.database("Failed to check post view", { cause: error });
		}
	}

	/**
	 * Get unique viewer count for a post
	 */
	async getUniqueViewerCount(postId: Types.ObjectId): Promise<number> {
		try {
			const session = this.getSession();
			return await this.model.countDocuments({ post: postId }).session(session || null);
		} catch (error: unknown) {
			throw Errors.database("Failed to count post views", { cause: error });
		}
	}

	/**
	 * Delete all views for a post when post is deleted
	 */
	async deleteByPost(postId: Types.ObjectId): Promise<void> {
		try {
			const session = this.getSession();
			await this.model.deleteMany({ post: postId }).session(session || null);
		} catch (error: unknown) {
			throw Errors.database("Failed to delete post views", { cause: error });
		}
	}

	async deleteManyByUserId(userId: string): Promise<number> {
		try {
			const session = this.getSession();
			const result = await this.model
				.deleteMany({ user: new Types.ObjectId(userId) })
				.session(session || null)
				.exec();
			return result.deletedCount || 0;
		} catch (error: unknown) {
			throw Errors.database("Failed to delete post views by user", { cause: error });
		}
	}
}



