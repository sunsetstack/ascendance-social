import {
  CursorPaginationOptions,
  CursorPaginationResult,
  FeedPost,
  PaginationResult,
  TrendingTag,
} from "@/types";

/**
 * Read-only Data Access Object tailored for executing complex Feed aggregations.
 * This separates heavy analytical queries from the domain-focused PostRepository.
 */
export interface IFeedReadDao {
  getFeedForUserCoreWithCursor(
    followingIds: string[],
    favoriteTags: string[],
    options: CursorPaginationOptions
  ): Promise<CursorPaginationResult<FeedPost>>;

  getRankedFeed(favoriteTags: string[], limit: number, skip: number): Promise<PaginationResult<FeedPost>>;

  getTrendingFeed(
    limit: number,
    skip: number,
    options?: {
      timeWindowDays?: number;
      minLikes?: number;
      weights?: { recency?: number; popularity?: number; comments?: number };
    },
  ): Promise<PaginationResult<FeedPost>>;

  getNewFeed(limit: number, skip: number): Promise<PaginationResult<FeedPost>>;

  getTrendingTags(limit: number, timeWindowHours: number): Promise<TrendingTag[]>;

  getNewFeedWithCursor(options: CursorPaginationOptions): Promise<CursorPaginationResult<FeedPost>>;

  getTrendingFeedWithCursor(
    options: CursorPaginationOptions & {
      timeWindowDays?: number;
      minLikes?: number;
      weights?: { recency?: number; popularity?: number; comments?: number };
    }
  ): Promise<CursorPaginationResult<FeedPost>>;

  getRankedFeedWithCursor(
    favoriteTags: string[],
    options: CursorPaginationOptions & {
      weights?: { recency?: number; popularity?: number; tagMatch?: number };
    }
  ): Promise<CursorPaginationResult<FeedPost>>;

  getNewFeedWithFacet(limit: number, skip: number): Promise<PaginationResult<FeedPost>>;

  getTrendingFeedWithFacet(
    limit: number,
    skip: number,
    options?: {
      timeWindowDays?: number;
      minLikes?: number;
      weights?: { recency?: number; popularity?: number; comments?: number };
    }
  ): Promise<PaginationResult<FeedPost>>;
}
