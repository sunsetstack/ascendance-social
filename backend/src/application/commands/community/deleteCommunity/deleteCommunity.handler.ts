import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { DeleteCommunityCommand } from "./deleteCommunity.command";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { UserRepository } from "@/repositories/user.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { Errors } from "@/utils/errors";

@injectable()
export class DeleteCommunityCommandHandler implements ICommandHandler<DeleteCommunityCommand, void> {
	constructor(
		@inject(CommunityRepository) private communityRepository: CommunityRepository,
		@inject(CommunityMemberRepository) private communityMemberRepository: CommunityMemberRepository,
		@inject(UserRepository) private userRepository: UserRepository,
		@inject(UnitOfWork) private uow: UnitOfWork
	) {}

	async execute(command: DeleteCommunityCommand): Promise<void> {
		const { communityId: communityPublicId, userId: userPublicId } = command;

		const community = await this.communityRepository.findByPublicId(communityPublicId);
		if (!community) {
			throw Errors.notFound("Community");
		}
		const communityId = community._id as Types.ObjectId;

		const user = await this.userRepository.findByPublicId(userPublicId);
		if (!user) {
			throw Errors.notFound("User");
		}
		const userId = user._id as Types.ObjectId;

		// 1. Check permissions
		const member = await this.communityMemberRepository.findByCommunityAndUser(communityId, userId);
		if (!member || member.role !== "admin") {
			throw Errors.forbidden("Only community admins can delete the community");
		}

		await this.uow.executeInTransaction(async () => {
			// 2. Delete all memberships
			await this.communityMemberRepository.deleteByCommunityId(communityId);

			// 3. Delete Community
			await this.communityRepository.delete(communityId.toString());
		});
	}
}
