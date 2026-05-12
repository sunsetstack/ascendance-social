import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { KickMemberCommand } from "./kickMember.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";

@injectable()
export class KickMemberCommandHandler implements ICommandHandler<KickMemberCommand, void> {
	constructor(
		@inject(CommunityRepository) private communityRepository: CommunityRepository,
		@inject(CommunityMemberRepository) private communityMemberRepository: CommunityMemberRepository,
		@inject(UserRepository) private userRepository: UserRepository,
		@inject(UnitOfWork) private uow: UnitOfWork
	) {}

	async execute(command: KickMemberCommand): Promise<void> {
		const { communityId: communityPublicId, adminId: adminPublicId, targetUserId: targetUserPublicId } = command;

		const community = await this.communityRepository.findByPublicId(communityPublicId);
		if (!community) {
			throw Errors.notFound("Community");
		}
		const communityId = community._id as Types.ObjectId;

		const adminUser = await this.userRepository.findByPublicId(adminPublicId);
		if (!adminUser) {
			throw Errors.notFound("User");
		}
		const adminId = adminUser._id as Types.ObjectId;

		const targetUser = await this.userRepository.findByPublicId(targetUserPublicId);
		if (!targetUser) {
			throw Errors.notFound("User");
		}
		const targetUserId = targetUser._id as Types.ObjectId;

		// 1. Verify Admin Permissions
		const adminMember = await this.communityMemberRepository.findByCommunityAndUser(communityId, adminId);
		if (!adminMember || (adminMember.role !== "admin" && adminMember.role !== "moderator")) {
			throw Errors.forbidden("Only admins or moderators can kick members");
		}

		// 2. Verify Target exists and is not an admin
		const targetMember = await this.communityMemberRepository.findByCommunityAndUser(communityId, targetUserId);
		if (!targetMember) {
			throw Errors.notFound("Resource");
		}
		if (targetMember.role === "admin") {
			throw Errors.forbidden("Cannot kick an admin");
		}

		await this.uow.executeInTransaction(async () => {
			// 3. Remove Member
			await this.communityMemberRepository.deleteByCommunityAndUser(communityId, targetUserId);

			// 4. Update User Cache (Remove from array)
			await this.userRepository.update(
				targetUserId.toString(),
				{
					$pull: {
						joinedCommunities: { _id: communityId },
					},
				}
			);

			// 5. Decrement Member Count
			await this.communityRepository.findOneAndUpdate(
				{ _id: communityId },
				{ $inc: { "stats.memberCount": -1 } }
			);
		});
	}
}
