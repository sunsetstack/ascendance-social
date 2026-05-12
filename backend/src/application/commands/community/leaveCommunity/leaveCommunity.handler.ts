import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { LeaveCommunityCommand } from "./leaveCommunity.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";

@injectable()
export class LeaveCommunityCommandHandler implements ICommandHandler<LeaveCommunityCommand, void> {
	constructor(
		@inject(CommunityRepository) private communityRepository: CommunityRepository,
		@inject(CommunityMemberRepository) private communityMemberRepository: CommunityMemberRepository,
		@inject(UserRepository) private userRepository: UserRepository,
		@inject(UnitOfWork) private uow: UnitOfWork
	) {}

	async execute(command: LeaveCommunityCommand): Promise<void> {
		const { communityId: communityPublicId, userId: userPublicId } = command;

		const user = await this.userRepository.findByPublicId(userPublicId);
		if (!user) {
			throw Errors.notFound("User");
		}
		const userId = user._id as Types.ObjectId;

		const community = await this.communityRepository.findByPublicId(communityPublicId);
		if (!community) {
			throw Errors.notFound("Community");
		}
		const communityId = community._id as Types.ObjectId;

		const member = await this.communityMemberRepository.findByCommunityAndUser(communityId, userId);
		if (!member) {
			throw Errors.validation("User is not a member of this community");
		}

		await this.uow.executeInTransaction(async () => {
			// 1. Remove Member
			await this.communityMemberRepository.deleteByCommunityAndUser(communityId, userId);

			// 2. Update User Cache (Remove from array)
			await this.userRepository.update(
				userId.toString(),
				{
					$pull: {
						joinedCommunities: { _id: communityId },
					},
				}
			);

			// 3. Decrement Member Count
			await this.communityRepository.findOneAndUpdate(
				{ _id: communityId },
				{ $inc: { "stats.memberCount": -1 } }
			);
		});
	}
}
