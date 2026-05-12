import { PostRepository } from "@/repositories/post.repository";
import { TagRepository } from "@/repositories/tag.repository";
import { UserRepository } from "@/repositories/user.repository";
import { CommunityRepository } from "@/repositories/community.repository";
import { PostDTO } from "@/types";
import { Errors } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  DTOService,
  PublicUserDTO,
  CommunityDTO,
} from "@/services/dto.service";

@injectable()
export class SearchService {
  constructor(
    @inject(TOKENS.Repositories.Post) private readonly postRepository: PostRepository,
    @inject(TOKENS.Repositories.User) private readonly userRepository: UserRepository,
    @inject(TOKENS.Repositories.Tag) private readonly tagRepository: TagRepository,
    @inject(TOKENS.Repositories.Community)
    private readonly communityRepository: CommunityRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  /** Universal search function. It uses a query and search throughout the database for users, posts, and communities.
   */
  async searchAll(query: string[]): Promise<{
    users: PublicUserDTO[] | null;
    posts: PostDTO[] | null;
    communities: CommunityDTO[] | null;
  }> {
    try {
      // Execute independent search queries in parallel
      const [users, communities, tags, textPosts] = await Promise.all([
        this.userRepository.getAll({ search: query }),
        this.communityRepository.search(query),
        this.tagRepository.searchTags(query),
        this.postRepository.searchByText(query),
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
      const message = error instanceof Error ? error.message : String(error);
      throw Errors.internal(message, {
        context: { function: "searchAll", query },
      });
    }
  }
}
