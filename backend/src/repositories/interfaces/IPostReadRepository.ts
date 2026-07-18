import { FeedPost, IPost, PaginationOptions, PaginationResult } from "@/types";
import { MongoId, PostPublicId, UserPublicId } from "@/types/branded";

/**
 * Read-only repository interface for post queries
 * used by query handlers in CQRS
 */
export interface IPostReadRepository {
  searchByText(terms: string[], limit?: number): Promise<FeedPost[]>;

  // single post lookups
  findById(id: MongoId): Promise<IPost | null>;
  findInternalIdByPublicId(publicId: PostPublicId): Promise<MongoId | null>;
  findOneByPublicId(publicId: PostPublicId): Promise<IPost | null>;
  findByIdWithPopulates(id: MongoId): Promise<IPost | null>;
  findByPublicId(publicId: PostPublicId): Promise<IPost | null>;
  findBySlug(slug: string): Promise<IPost | null>;

  // batch lookups
  findPostsByIds(
    ids: MongoId[],
    viewerPublicId?: UserPublicId,
  ): Promise<FeedPost[]>;
  findPostsByPublicIds(publicIds: PostPublicId[]): Promise<FeedPost[]>;
  findInternalIdsByPublicIds(publicIds: PostPublicId[]): Promise<MongoId[]>;

  findByUserPublicId(
    userPublicId: UserPublicId,
    options: PaginationOptions,
  ): Promise<PaginationResult<FeedPost>>;
  findByCommunityId(
    communityId: string,
    page: number,
    limit: number,
  ): Promise<IPost[]>;
  findByTags(
    tagIds: string[],
    options?: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
    },
  ): Promise<PaginationResult<IPost>>;

  // paginated queries
  findWithPagination(
    options: PaginationOptions,
  ): Promise<PaginationResult<FeedPost>>;

  // single post by arbitrary filter
  findOneByFilter(filter: Record<string, unknown>): Promise<IPost | null>;

  // counts
  countDocuments(filter: Record<string, unknown>): Promise<number>;
  countByCommunityId(communityId: string): Promise<number>;
}
