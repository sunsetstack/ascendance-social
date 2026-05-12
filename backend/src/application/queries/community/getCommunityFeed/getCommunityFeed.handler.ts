import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetCommunityFeedQuery } from "./getCommunityFeed.query";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { DTOService } from "@/services/dto.service";
import { PostDTO } from "@/types";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

interface PaginatedPosts {
  data: PostDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@injectable()
export class GetCommunityFeedQueryHandler implements IQueryHandler<
  GetCommunityFeedQuery,
  PaginatedPosts
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private postRepository: IPostReadRepository,
    @inject(CommunityRepository)
    private communityRepository: CommunityRepository,
    @inject(CommunityMemberRepository)
    private communityMemberRepository: CommunityMemberRepository,
    @inject(DTOService) private dtoService: DTOService,
  ) {}

  async execute(query: GetCommunityFeedQuery): Promise<PaginatedPosts> {
    const { communityId: communityPublicId, page, limit } = query;

    const community =
      await this.communityRepository.findByPublicId(communityPublicId);
    if (!community) {
      throw Errors.notFound("Community");
    }

    const communityId = community._id.toString();
    const posts = await this.postRepository.findByCommunityId(
      communityId,
      page,
      limit,
    );
    const total = await this.postRepository.countByCommunityId(communityId);
    const totalPages = Math.ceil(total / limit);

    // Get unique authors
    const authorIds = [
      ...new Set(posts.map((post) => post.author?._id || post.user)),
    ];

    // Fetch member roles for these authors
    const members =
      await this.communityMemberRepository.findByCommunityAndUsers(
        communityId,
        authorIds,
      );
    const memberMap = new Map(members.map((m) => [m.userId.toString(), m]));

    const dtos = posts.map((post) => {
      const dto = this.dtoService.toPostDTO(post);
      const authorId = post.author?._id?.toString() || post.user?.toString();
      const member = memberMap.get(authorId);

      if (member && (member.role === "admin" || member.role === "moderator")) {
        dto.authorCommunityRole = member.role;
      }

      return dto;
    });

    return { data: dtos, total, page, limit, totalPages };
  }
}
