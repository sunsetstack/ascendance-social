import { CommunityPublicId, UserPublicId } from "@/types/branded";

export interface PublicUserDTO {
  publicId: UserPublicId;
  handle: string;
  username: string;
  avatar: string;
  cover: string;
  bio: string;
  createdAt: Date;
  postCount: number;
  followerCount: number;
  followingCount: number;
}

export interface HandleSuggestionDTO {
  publicId: UserPublicId;
  handle: string;
  username: string;
  avatar: string;
}

export interface AuthenticatedUserDTO extends PublicUserDTO {
  email: string;
  isEmailVerified: boolean;
}

export interface AccountInfoDTO {
  publicId: UserPublicId;
  handle: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  createdAt: Date;
  registrationIp?: string;
}

export interface AdminUserDTO extends AuthenticatedUserDTO {
  isAdmin: boolean;
  isBanned: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  bannedBy?: string;
  updatedAt: Date;
  registrationIp?: string;
  lastActive?: Date;
  lastIp?: string;
}

export interface CommunityDTO {
  publicId: CommunityPublicId;
  name: string;
  slug: string;
  description: string;
  avatar?: string;
  coverPhoto?: string;
  stats: {
    memberCount: number;
    postCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
  isMember?: boolean;
  isCreator?: boolean;
  isAdmin?: boolean;
}

export interface CommunityMemberDTO {
  userId: {
    publicId: string;
    handle: string;
    username: string;
    avatar?: string;
  };
  role: "admin" | "moderator" | "member";
  joinedAt: Date;
}
