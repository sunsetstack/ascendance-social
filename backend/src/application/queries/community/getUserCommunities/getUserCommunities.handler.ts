import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetUserCommunitiesQuery } from "./getUserCommunities.query";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { CommunityRepository } from "@/repositories/community.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { PaginationResult } from "@/types";
import { DTOService, CommunityDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { Types } from "mongoose";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetUserCommunitiesQueryHandler implements IQueryHandler<
  GetUserCommunitiesQuery,
  PaginationResult<CommunityDTO>
> {
  constructor(
    @inject(CommunityMemberRepository)
    private communityMemberRepository: CommunityMemberRepository,
    @inject(CommunityRepository)
    private communityRepository: CommunityRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private dtoService: DTOService,
  ) {}

  async execute(
    query: GetUserCommunitiesQuery,
  ): Promise<PaginationResult<CommunityDTO>> {
    const { userId: userPublicId, page, limit } = query;

    const user = await this.userRepository.findByPublicId(userPublicId);
    if (!user) {
      throw Errors.notFound("User");
    }
    const userId = user._id;

    const skip = (page - 1) * limit;

    // get total count for pagination
    const total = await this.communityMemberRepository.countByUser(
      userId as Types.ObjectId,
    );
    const totalPages = Math.ceil(total / limit);

    const memberships = await this.communityMemberRepository.findByUser(
      userId as Types.ObjectId,
      limit,
      skip,
    );
    const communityIds = memberships.map((m) => m.communityId.toString());

    const communities = await this.communityRepository.findByIds(communityIds);

    // user is querying their own communities so they are members of all of them
    const data = communities.map((c) => {
      return this.dtoService.toCommunityDTO(c, {
        memberCount: c.stats?.memberCount ?? 0,
        isMember: true,
        isCreator: c.creatorId?.toString() === userId.toString(),
      });
    });

    return { data, total, page, limit, totalPages };
  }
}
