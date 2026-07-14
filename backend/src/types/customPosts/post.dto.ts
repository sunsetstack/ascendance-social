import { PaginationResult } from "../customCore/pagination.types";
import { PublicUserDTO } from "../customUsers/dto.types";
import {
  PostPublicId,
  UserPublicId,
  ImagePublicId,
  CommunityPublicId,
} from "@/types/branded";

export interface PostDTO {
  publicId: PostPublicId;
  body?: string; // text content of the post
  slug?: string;
  type?: "original" | "repost";
  repostCount?: number;
  repostOf?: {
    publicId: PostPublicId;
    user: {
      publicId: UserPublicId;
      handle: string;
      username: string;
      avatar: string;
    };
    body?: string;
    slug?: string;
    image?: {
      url: string;
      publicId: ImagePublicId;
      width?: number;
      height?: number;
    } | null;
    likes?: number;
    repostCount?: number;
    commentsCount?: number;
  };

  // Image data - nested format
  image?: {
    url: string;
    publicId: ImagePublicId;
    width?: number;
    height?: number;
  } | null;

  // Legacy: Flattened image data for backward compatibility
  url?: string;
  imagePublicId?: ImagePublicId;

  tags: string[];
  likes: number;
  commentsCount: number;
  viewsCount: number;
  createdAt: Date;

  user: {
    publicId: UserPublicId;
    handle: string;
    username: string;
    avatar: string;
  };

  // Community info for community posts
  community?: {
    publicId: CommunityPublicId;
    name: string;
    slug: string;
    avatar?: string;
  } | null;

  isLikedByViewer?: boolean;
  isFavoritedByViewer?: boolean;
  isRepostedByViewer?: boolean;
  canDelete?: boolean;
  authorCommunityRole?: "admin" | "moderator" | "member";
}

export interface UserPostsResult extends PaginationResult<PostDTO> {
  profile: PublicUserDTO;
}
