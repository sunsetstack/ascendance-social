import { Document, Types } from "mongoose";
import { ICommunityCacheItem } from "../customCommunities/communityCacheItem.types";
import { UserPublicId } from "@/types/branded";

export interface IUser extends Document {
  publicId: UserPublicId;
  handle: string;
  handleNormalized: string;
  username: string;
  email: string;
  joinedCommunities: ICommunityCacheItem[];
  avatar: string;
  cover: string;
  password: string;
  bio: string;
  createdAt: Date;
  updatedAt: Date;
  registrationIp?: string;
  lastActive?: Date;
  lastIp?: string;
  isAdmin: boolean;
  isBanned: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  bannedBy?: Types.ObjectId | string;
  postCount?: number;
  followerCount?: number;
  followingCount?: number;
  resetToken?: string;
  resetTokenExpires?: Date;
  isEmailVerified?: boolean;
  emailVerificationToken?: string;
  emailVerificationExpires?: Date;

}

// Create a user lookup map using publicId
export type UserLookupData = Pick<IUser, "publicId" | "username"> &
  Partial<Pick<IUser, "handle" | "avatar">>;

/** Shape returned by user suggestion aggregation queries */
export type UserSuggestion = Pick<
  IUser,
  "publicId" | "handle" | "username" | "avatar"
> & {
  bio?: string;
  followerCount: NonNullable<IUser["followerCount"]>;
  postCount: NonNullable<IUser["postCount"]>;
  totalLikes: number;
  score: number;
};
