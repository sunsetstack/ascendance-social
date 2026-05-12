import { Model, Types } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IPostLike } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostLikeRepository extends BaseRepository<IPostLike> {
	constructor(@inject(TOKENS.Models.PostLike) model: Model<IPostLike>) {
		super(model);
	}

	async addLike(postId: string, userId: string): Promise<boolean> {
		const payload = {
			postId: this.normalizeId(postId, "postId"),
			userId: this.normalizeId(userId, "userId"),
		};

		try {
			const session = this.getSession();
			await this.model.create([payload], { session });
			return true;
		} catch (error: unknown) {
			if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
				return false;
			}
			throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to persist post like");
		}
	}

	async removeLike(postId: string, userId: string): Promise<boolean> {
		const session = this.getSession();
		const normalizedPostId = this.normalizeId(postId, "postId");
		const normalizedUserId = this.normalizeId(userId, "userId");
		const query = this.model.deleteOne({ postId: normalizedPostId, userId: normalizedUserId });
		if (session) query.session(session);
		const result = await query.exec();
		return (result.deletedCount ?? 0) > 0;
	}

	async hasUserLiked(postId: string, userId: string): Promise<boolean> {
		const session = this.getSession();
		const normalizedPostId = this.normalizeId(postId, "postId");
		const normalizedUserId = this.normalizeId(userId, "userId");
		const query = this.model.exists({ postId: normalizedPostId, userId: normalizedUserId });
		if (session) query.session(session);
		const exists = await query.exec();
		return Boolean(exists);
	}

	async removeLikesByUser(userId: string): Promise<number> {
		const session = this.getSession();
		const normalizedUserId = this.normalizeId(userId, "userId");
		const query = this.model.deleteMany({ userId: normalizedUserId });
		if (session) query.session(session);
		const result = await query.exec();
		return result.deletedCount ?? 0;
	}

	async removeLikesByPost(postId: string): Promise<number> {
		const session = this.getSession();
		const normalizedPostId = this.normalizeId(postId, "postId");
		const query = this.model.deleteMany({ postId: normalizedPostId });
		if (session) query.session(session);
		const result = await query.exec();
		return result.deletedCount ?? 0;
	}

	async countLikesByUser(userId: string): Promise<number> {
		const session = this.getSession();
		const normalizedUserId = this.normalizeId(userId, "userId");
		const query = this.model.countDocuments({ userId: normalizedUserId });
		if (session) query.session(session);
		return await query.exec();
	}

	async countLikesForPost(postId: string): Promise<number> {
		const session = this.getSession();
		const normalizedPostId = this.normalizeId(postId, "postId");
		const query = this.model.countDocuments({ postId: normalizedPostId });
		if (session) query.session(session);
		return await query.exec();
	}

	async findLikedPostIdsByUser(
		userId: string,
		page: number,
		limit: number,
		sortBy: string = "createdAt",
		sortOrder: "asc" | "desc" = "desc"
	): Promise<{ postIds: Types.ObjectId[]; total: number }> {
		const normalizedUserId = this.normalizeId(userId, "userId");
		const skip = (page - 1) * limit;

		const [likes, total] = await Promise.all([
			this.model
				.find({ userId: normalizedUserId })
				.sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
				.skip(skip)
				.limit(limit)
				.select("postId")
				.lean()
				.exec(),
			this.model.countDocuments({ userId: normalizedUserId }),
		]);

		return {
			postIds: likes.map((like) => 
				like.postId instanceof Types.ObjectId ? like.postId : new Types.ObjectId(String(like.postId))
			),
			total,
		};
	}

	private normalizeId(id: string | Types.ObjectId, field: string): Types.ObjectId {
		if (id instanceof Types.ObjectId) {
			return id;
		}
		try {
			return new Types.ObjectId(String(id));
		} catch {
			throw Errors.validation(`${field} is not a valid ObjectId`);
		}
	}
}



