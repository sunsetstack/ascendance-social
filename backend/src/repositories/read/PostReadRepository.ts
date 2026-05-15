import { inject, injectable } from "tsyringe";
import { FeedPost, IPost, PaginationOptions, PaginationResult } from "@/types";
import type { IPostReadRepository } from "../interfaces/IPostReadRepository";
import { PostRepository } from "../post.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, PostPublicId, UserPublicId } from "@/types/branded";

/**
 * Read-only repository for post queries
 * delegates to the existing PostRepository for now
 * can be pointed to a read replica connection in the future
 */
@injectable()
export class PostReadRepository implements IPostReadRepository {
  constructor(
    @inject(TOKENS.Repositories.Post)
    private readonly postRepository: PostRepository,
  ) {}

  async findById(id: MongoId): Promise<IPost | null> {
    return this.postRepository.findById(id);
  }

  async findInternalIdByPublicId(
    publicId: PostPublicId,
  ): Promise<MongoId | null> {
    return this.postRepository.findInternalIdByPublicId(publicId);
  }

  async findOneByPublicId(publicId: PostPublicId): Promise<IPost | null> {
    return this.postRepository.findOneByPublicId(publicId);
  }

  async findByIdWithPopulates(id: MongoId): Promise<IPost | null> {
    return this.postRepository.findByIdWithPopulates(id);
  }

  async findByPublicId(publicId: PostPublicId): Promise<IPost | null> {
    return this.postRepository.findByPublicId(publicId);
  }

  async findBySlug(slug: string): Promise<IPost | null> {
    return this.postRepository.findBySlug(slug);
  }

  async findPostsByIds(
    ids: MongoId[],
    viewerPublicId?: UserPublicId,
  ): Promise<FeedPost[]> {
    return this.postRepository.findPostsByIds(ids, viewerPublicId);
  }

  async findPostsByPublicIds(publicIds: PostPublicId[]): Promise<FeedPost[]> {
    return this.postRepository.findPostsByPublicIds(publicIds);
  }

  async findByUserPublicId(
    userPublicId: UserPublicId,
    options: PaginationOptions,
  ): Promise<PaginationResult<FeedPost>> {
    return this.postRepository.findByUserPublicId(userPublicId, options);
  }

  async findByCommunityId(
    communityId: string,
    page: number,
    limit: number,
  ): Promise<IPost[]> {
    return this.postRepository.findByCommunityId(communityId, page, limit);
  }

  async findByTags(
    tagIds: string[],
    options?: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
    },
  ): Promise<PaginationResult<IPost>> {
    return this.postRepository.findByTags(tagIds, options);
  }

  async findWithPagination(
    options: PaginationOptions,
  ): Promise<PaginationResult<FeedPost>> {
    return this.postRepository.findWithPagination(options);
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.postRepository.countDocuments(filter);
  }

  async findOneByFilter(
    filter: Record<string, unknown>,
  ): Promise<IPost | null> {
    return this.postRepository.findOneByFilter(filter);
  }

  async countByCommunityId(communityId: string): Promise<number> {
    return this.postRepository.countByCommunityId(communityId);
  }
}
