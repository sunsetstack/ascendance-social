import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommunityMembersQuery } from "./getCommunityMembers.query";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { Errors } from "@/utils/errors";
import { PaginationResult } from "@/types";
import { DTOService, CommunityMemberDTO } from "@/services/dto.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetCommunityMembersQueryHandler implements IQueryHandler<GetCommunityMembersQuery, PaginationResult<CommunityMemberDTO>> {
	constructor(
		@inject(CommunityRepository) private communityRepository: CommunityRepository,
		@inject(CommunityMemberRepository) private communityMemberRepository: CommunityMemberRepository,
		@inject(TOKENS.Services.DTO) private dtoService: DTOService,
	) {}

	async execute(query: GetCommunityMembersQuery): Promise<PaginationResult<CommunityMemberDTO>> {
		const { communitySlug, page, limit } = query;

		const community = await this.communityRepository.findBySlug(communitySlug);
		if (!community) {
			throw Errors.notFound("Community");
		}

		const skip = (page - 1) * limit;
		const members = await this.communityMemberRepository.findByCommunityId(community._id, limit, skip);
		const total = await this.communityMemberRepository.countByCommunityId(community._id);
		const totalPages = Math.ceil(total / limit);

		const data = members.map((member) => this.dtoService.toCommunityMemberDTO(member));

		return { data, total, page, limit, totalPages };
	}
}
