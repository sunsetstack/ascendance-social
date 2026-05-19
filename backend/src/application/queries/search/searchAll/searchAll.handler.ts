import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { SearchAllQuery } from "./searchAll.query";
import type { IPostReadRepository, IUserReadRepository } from "@/repositories/interfaces";
import { TagRepository } from "@/repositories/tag.repository";
import { CommunityRepository } from "@/repositories/community.repository";
import { PostDTO } from "@/types";
import { wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  DTOService,
  PublicUserDTO,
  CommunityDTO,
} from "@/services/dto.service";

export interface SearchAllResult {
  users: PublicUserDTO[] | null;
  posts: PostDTO[] | null;
  communities: CommunityDTO[] | null;
}

@injectable()
export class SearchAllQueryHandler implements IQueryHandler<
  SearchAllQuery,
  SearchAllResult
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Tag)
    private readonly tagRepository: TagRepository,
    @inject(TOKENS.Repositories.Community)
    private readonly communityRepository: CommunityRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: SearchAllQuery): Promise<SearchAllResult> {
    try {
      const searchTerms = query.query;
      // Execute independent search queries in parallel
      const [users, communities, tags, textPosts] = await Promise.all([
        this.userReadRepository.getAll({ search: searchTerms }),
        this.communityRepository.search(searchTerms),
        this.tagRepository.searchTags(searchTerms),
        this.postRepository.searchByText(searchTerms),
      ]);

      // Search for posts by tag IDs (dependent on tags result)
      const tagIds = tags.map((tag) => tag._id);
      const tagPostsResult = await this.postRepository.findByTags(
        tagIds as string[],
      );
      const tagPosts = tagPostsResult?.data ?? [];

      const allPosts = [...(textPosts ?? []), ...tagPosts];
      const uniquePostsMap = new Map<string, any>();

      for (const post of allPosts) {
        if (post && post.publicId && !uniquePostsMap.has(post.publicId)) {
          uniquePostsMap.set(post.publicId, post);
        }
      }

      const uniquePosts = Array.from(uniquePostsMap.values());
      const postDTOs = uniquePosts.map((post) =>
        this.dtoService.toPostDTO(post),
      );

      const userDTOs =
        users?.map((user) => this.dtoService.toPublicDTO(user)) ?? [];
      const communityDTOs =
        communities?.map((community) =>
          this.dtoService.toCommunityDTO(community),
        ) ?? [];

      return {
        users: userDTOs.length ? userDTOs : null,
        posts: postDTOs.length ? postDTOs : null,
        communities: communityDTOs.length ? communityDTOs : null,
      };
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: { operation: "searchAll", query: query.query },
      });
    }
  }
}
