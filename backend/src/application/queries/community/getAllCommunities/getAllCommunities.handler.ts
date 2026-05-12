import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetAllCommunitiesQuery } from "./getAllCommunities.query";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { PaginationResult } from "@/types";
import { DTOService, CommunityDTO } from "@/services/dto.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetAllCommunitiesQueryHandler implements IQueryHandler<
  GetAllCommunitiesQuery,
  PaginationResult<CommunityDTO>
> {
  constructor(
    @inject(CommunityRepository)
    private communityRepository: CommunityRepository,
    @inject(CommunityMemberRepository)
    private communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private dtoService: DTOService,
  ) {}

  async execute(
    query: GetAllCommunitiesQuery,
  ): Promise<PaginationResult<CommunityDTO>> {
    const { page, limit, search, viewerPublicId } = query;
    const result = await this.communityRepository.findAll(page, limit, search);

    if (result.data.length === 0) {
      return {
        data: [],
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      };
    }

    const communityIds = result.data.map((community) => community._id);

    let viewerId = "";
    let membershipSet = new Set<string>();

    if (viewerPublicId) {
      const viewer =
        await this.userReadRepository.findByPublicId(viewerPublicId);
      if (viewer) {
        viewerId = viewer._id?.toString() ?? viewer.id?.toString() ?? "";
        if (viewerId) {
          const memberships =
            await this.communityMemberRepository.findByUserAndCommunityIds(
              viewerId,
              communityIds,
            );
          membershipSet = new Set(
            memberships.map((member) => member.communityId.toString()),
          );
        }
      }
    }

    const data = result.data.map((community) => {
      const communityId = community._id.toString();
      return this.dtoService.toCommunityDTO(community, {
        memberCount: community.stats?.memberCount ?? 0,
        isMember: membershipSet.has(communityId),
        isCreator: community.creatorId?.toString() === viewerId,
      });
    });

    return { ...result, data };
  }
}
