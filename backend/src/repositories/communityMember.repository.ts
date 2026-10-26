import { injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { ICommunityMember } from "@/types";
import { CommunityMember } from "@/models/communityMember.model";
import { Types } from "mongoose";

@injectable()
export class CommunityMemberRepository extends BaseRepository<ICommunityMember> {
	constructor() {
		super(CommunityMember);
	}

	async findByCommunityAndUser(
		communityId: string | Types.ObjectId,
		userId: string | Types.ObjectId,
	): Promise<ICommunityMember | null> {
		const session = this.getSession();
		const query = this.model.findOne({ communityId, userId });
		if (session) query.session(session);
		return query.exec();
	}

	async findByCommunityAndUsers(
		communityId: string | Types.ObjectId,
		userIds: (string | Types.ObjectId)[],
	): Promise<ICommunityMember[]> {
		return this.model.find({ communityId, userId: { $in: userIds } }).exec();
	}

	async findByUser(userId: string | Types.ObjectId, limit: number = 20, skip: number = 0): Promise<ICommunityMember[]> {
		return this.model.find({ userId }).limit(limit).skip(skip).exec();
	}

	async findByUserAndCommunityIds(
		userId: string | Types.ObjectId,
		communityIds: (string | Types.ObjectId)[],
	): Promise<ICommunityMember[]> {
		return this.model.find({ userId, communityId: { $in: communityIds } }).exec();
	}

	async deleteByCommunityAndUser(
		communityId: string | Types.ObjectId,
		userId: string | Types.ObjectId,
	): Promise<boolean> {
		const session = this.getSession();
		const query = this.model.deleteOne({ communityId, userId });
		if (session) query.session(session);
		const result = await query.exec();
		return result.deletedCount === 1;
	}

	async deleteByCommunityId(communityId: string | Types.ObjectId): Promise<void> {
		const session = this.getSession();
		const query = this.model.deleteMany({ communityId });
		if (session) query.session(session);
		await query.exec();
	}

	async deleteManyByUserId(userId: string | Types.ObjectId): Promise<void> {
		const session = this.getSession();
		const query = this.model.deleteMany({ userId });
		if (session) query.session(session);
		await query.exec();
	}

	async countByUser(userId: string | Types.ObjectId): Promise<number> {
		return this.model.countDocuments({ userId }).exec();
	}

	async findByCommunityId(
		communityId: string | Types.ObjectId,
		limit: number = 20,
		skip: number = 0,
	): Promise<ICommunityMember[]> {
		return this.model
			.find({ communityId })
			.populate("userId", "publicId handle username avatar")
			.limit(limit)
			.skip(skip)
			.exec();
	}

	async countByCommunityId(communityId: string | Types.ObjectId): Promise<number> {
		return this.model.countDocuments({ communityId }).exec();
	}
}
