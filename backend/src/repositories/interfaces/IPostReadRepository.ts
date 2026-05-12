import { FeedPost, IPost, PaginationOptions, PaginationResult } from "@/types";

/**
 * Read-only repository interface for post queries
 * used by query handlers in CQRS pattern
 */
export interface IPostReadRepository {
  // single post lookups
  findById(id: string): Promise<IPost | null>;
  findInternalIdByPublicId(publicId: string): Promise<string | null>;
  findOneByPublicId(
    publicId: string,
  ): Promise<IPost | null>;
  findByIdWithPopulates(
    id: string,
  ): Promise<IPost | null>;
  findByPublicId(
    publicId: string,
  ): Promise<IPost | null>;
  findBySlug(slug: string): Promise<IPost | null>;
  // batch lookups
  findPostsByIds(ids: string[], viewerPublicId?: string): Promise<FeedPost[]>;
  findPostsByPublicIds(publicIds: string[]): Promise<FeedPost[]>;
  findByUserPublicId(
    userPublicId: string,
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
