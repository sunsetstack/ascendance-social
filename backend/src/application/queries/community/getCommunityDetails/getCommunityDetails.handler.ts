import { inject, injectable } from "tsyringe";
import { Types } from "mongoose";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommunityDetailsQuery } from "./getCommunityDetails.query";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { DTOService, CommunityDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetCommunityDetailsQueryHandler implements IQueryHandler<
  GetCommunityDetailsQuery,
  CommunityDTO
> {
  constructor(
    @inject(CommunityRepository)
    private communityRepository: CommunityRepository,
    @inject(CommunityMemberRepository)
    private communityMemberRepository: CommunityMemberRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userRepository: IUserReadRepository,
    @inject(TOKENS.Services.DTO) private dtoService: DTOService,
  ) {}

  async execute(query: GetCommunityDetailsQuery): Promise<CommunityDTO> {
    const community = await this.communityRepository.findBySlug(query.slug);
    if (!community) {
      throw Errors.notFound("Community");
    }

    const actualMemberCount = community.stats?.memberCount ?? 0;

    const options: {
      memberCount?: number;
      isMember?: boolean;
      isCreator?: boolean;
      isAdmin?: boolean;
    } = {
      memberCount: actualMemberCount,
    };

    // check if viewer is a member
    if (query.viewerPublicId) {
      const user = await this.userRepository.findByPublicId(
        query.viewerPublicId,
      );
      if (user) {
        const membership =
          await this.communityMemberRepository.findByCommunityAndUser(
            community._id as Types.ObjectId,
            user._id as Types.ObjectId,
          );
        options.isMember = !!membership;
        options.isAdmin = membership?.role === "admin";
        options.isCreator =
          community.creatorId.toString() ===
          (user._id as Types.ObjectId).toString();
      }
    }

    return this.dtoService.toCommunityDTO(community, options);
  }
}
