import { Types } from "mongoose";
import { injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { ICommunity } from "@/types";
import { escapeRegex } from "@/utils/sanitizers";
import { Community } from "@/models/community.model";

@injectable()
export class CommunityRepository extends BaseRepository<ICommunity> {
	constructor() {
		super(Community);
	}

	async findBySlug(slug: string): Promise<ICommunity | null> {
		return this.model.findOne({ slug }).exec();
	}

	async findByIds(ids: string[]): Promise<ICommunity[]> {
		return this.model.find({ _id: { $in: ids } }).exec();
	}

	async search(terms: string[]): Promise<ICommunity[]> {
		const regexQueries = terms.map((term) => ({
			$or: [
				{ name: { $regex: escapeRegex(term), $options: "i" } },
				{ description: { $regex: escapeRegex(term), $options: "i" } },
			],
		}));

		return this.model.find({ $or: regexQueries }).limit(20).exec();
	}

	async findAll(
		page: number,
		limit: number,
		search?: string
	): Promise<{ data: ICommunity[]; total: number; page: number; limit: number; totalPages: number }> {
		const query: Record<string, unknown> = {};
		if (search) {
			query.$or = [
				{ name: { $regex: escapeRegex(search), $options: "i" } },
				{ description: { $regex: escapeRegex(search), $options: "i" } },
			];
		}

		const total = await this.model.countDocuments(query);
		const totalPages = Math.ceil(total / limit);
		const skip = (page - 1) * limit;

		const data = await this.model.find(query).skip(skip).limit(limit).sort({ createdAt: -1 }).exec();

		return { data, total, page, limit, totalPages };
	}

	async findByPublicId(publicId: string): Promise<ICommunity | null> {
		return this.model.findOne({ publicId }).exec();
	}

	async decrementMemberCountsByIds(ids: (string | Types.ObjectId)[]): Promise<void> {
		const normalizedIds = Array.from(
			new Set(
				ids
					.map((id) => id?.toString())
					.filter((id): id is string => typeof id === "string" && id.length > 0),
			),
		).map((id) => new Types.ObjectId(id));

		if (normalizedIds.length === 0) {
			return;
		}

		const session = this.getSession();
		const query = this.model.updateMany({ _id: { $in: normalizedIds } }, { $inc: { "stats.memberCount": -1 } });
		if (session) {
			query.session(session);
		}
		await query.exec();
	}
}
