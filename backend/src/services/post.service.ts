import { inject, injectable } from "tsyringe";
import { PostRepository } from "@/repositories/post.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { UserRepository } from "@/repositories/user.repository";
import { TagRepository } from "@/repositories/tag.repository";
import { DTOService } from "./dto.service";
import { Errors, wrapError } from "@/utils/errors";
import { ITag, PaginationResult, PostDTO, toObjectId } from "@/types";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { TagService } from "./tag.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostService {
  constructor(
    @inject(TOKENS.Repositories.Post)
    private readonly postRepository: PostRepository,
    @inject(TOKENS.Repositories.PostLike)
    private readonly postLikeRepository: PostLikeRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
    @inject(TOKENS.Repositories.Tag)
    private readonly tagRepository: TagRepository,
    @inject(TOKENS.Repositories.Favorite)
    private readonly favoriteRepository: FavoriteRepository,
    @inject(TOKENS.Services.Tag) private readonly tagService: TagService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async getPostByPublicId(
    publicId: string,
    viewerPublicId?: string,
  ): Promise<PostDTO> {
    const post = await this.postRepository.findByPublicId(publicId);
    if (!post) {
      throw Errors.notFound("Post not found");
    }
    const dto = this.dtoService.toPostDTO(post);

    logger.info("[PostService.getPostByPublicId] viewerPublicId:", {
      viewerPublicId,
    });

    // Add viewer-specific fields if viewer is logged in
    if (viewerPublicId) {
      const postInternalId = toObjectId(post._id).toString();
      const viewerInternalId =
        await this.userRepository.findInternalIdByPublicId(viewerPublicId);

      logger.info("[PostService.getPostByPublicId] IDs:", {
        postInternalId,
        viewerInternalId,
      });

      if (postInternalId && viewerInternalId) {
        const [hasLiked, favoriteRecord] = await Promise.all([
          this.postLikeRepository.hasUserLiked(postInternalId, viewerInternalId),
          this.favoriteRepository.findByUserAndPost(viewerInternalId, postInternalId),
        ]);
        dto.isLikedByViewer = hasLiked;
        logger.info("[PostService.getPostByPublicId] like match:", {
          isLikedByViewer: dto.isLikedByViewer,
        });

        dto.isFavoritedByViewer = !!favoriteRecord;
        logger.info("[PostService.getPostByPublicId] favoriteRecord:", {
          isFavoritedByViewer: !!favoriteRecord,
        });
      }
    }

    logger.info("[PostService.getPostByPublicId] Returning DTO:", {
      publicId: dto.publicId,
      isLikedByViewer: dto.isLikedByViewer,
      isFavoritedByViewer: dto.isFavoritedByViewer,
    });

    return dto;
  }

  async getPostBySlug(slug: string): Promise<PostDTO> {
    const post = await this.postRepository.findBySlug(slug);
    if (!post) {
      throw Errors.notFound("Post not found");
    }
    return this.dtoService.toPostDTO(post);
  }

  async getPosts(
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    const result = await this.postRepository.findWithPagination({
      page,
      limit,
    });
    return {
      ...result,
      data: result.data.map((entry) => this.dtoService.toPostDTO(entry)),
    };
  }

  async getPostsByUserPublicId(
    userPublicId: string,
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    const result = await this.postRepository.findByUserPublicId(userPublicId, {
      page,
      limit,
    });
    return {
      ...result,
      data: result.data.map((entry) => this.dtoService.toPostDTO(entry)),
    };
  }

  async searchByTags(
    tags: string[],
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    if (tags.length === 0) {
      return this.getPosts(page, limit);
    }

    const tagIds = await this.tagService.resolveTagIds(tags);
    const result = await this.postRepository.findByTags(tagIds, {
      page,
      limit,
    });

    return {
      ...result,
      data: result.data.map((entry) => this.dtoService.toPostDTO(entry)),
    };
  }

  async getTags(): Promise<ITag[]> {
    return (await this.tagRepository.getAll()) ?? [];
  }

  private handleError(error: unknown, functionName: string): never {
    throw wrapError(error, "InternalServerError", {
      context: { function: functionName, file: "post.service.ts" },
    });
  }
}
