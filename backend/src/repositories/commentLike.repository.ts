import { Model, Types } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { ICommentLike } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class CommentLikeRepository extends BaseRepository<ICommentLike> {
	constructor(@inject(TOKENS.Models.CommentLike) model: Model<ICommentLike>) {
		super(model);
	}

	async addLike(commentId: string, userId: string): Promise<boolean> {
		const payload = {
			commentId: this.normalizeId(commentId, "commentId"),
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
			throw Errors.database((error instanceof Error ? error.message : String(error)) ?? "failed to persist comment like");
		}
	}

	async removeLike(commentId: string, userId: string): Promise<boolean> {
		const session = this.getSession();
		const normalizedCommentId = this.normalizeId(commentId, "commentId");
		const normalizedUserId = this.normalizeId(userId, "userId");
		const query = this.model.deleteOne({ commentId: normalizedCommentId, userId: normalizedUserId });
		if (session) query.session(session);
		const result = await query.exec();
		return (result.deletedCount ?? 0) > 0;
	}

	async hasUserLiked(commentId: string, userId: string): Promise<boolean> {
		const session = this.getSession();
		const normalizedCommentId = this.normalizeId(commentId, "commentId");
		const normalizedUserId = this.normalizeId(userId, "userId");
		const query = this.model.exists({ commentId: normalizedCommentId, userId: normalizedUserId });
		if (session) query.session(session);
		const exists = await query.exec();
		return Boolean(exists);
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



