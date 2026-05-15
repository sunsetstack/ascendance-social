import { UserPublicId } from "@/types/branded";
export interface FeedPost {
  publicId: string;
  body: string;
  slug: string;
  createdAt: Date;
  likes: number;
  commentsCount: number;
  viewsCount: number;
  userPublicId: UserPublicId;
  tags: { tag: string; publicId?: string }[];
  user: {
    publicId: string;
    handle: string;
    username: string;
    avatar: string;
  };
  image?: {
    publicId: string;
    url: string;
    slug: string;
  };
  community?: {
    publicId: string;
    name: string;
    slug: string;
    avatar?: string;
  } | null;
  rankScore?: number;
  trendScore?: number;
  isPersonalized?: boolean;
}

export interface PaginatedFeedResult {
  data: FeedPost[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  nextCursor?: string;
  prevCursor?: string;
  hasMore?: boolean;
}

export interface PostMeta {
  likes?: number;
  commentsCount?: number;
  viewsCount?: number;
}

export interface CoreFeed {
  data: FeedPost[];
  page?: number;
  limit: number;
  total?: number;
  totalPages?: number;
  hasMore?: boolean;
  nextCursor?: string;
  prevCursor?: string;
}
