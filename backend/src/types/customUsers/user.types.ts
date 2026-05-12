import { Document, Types } from "mongoose";
import { IPost } from "../customPosts/posts.types";
import { ICommunityCacheItem } from "../customCommunities/communityCacheItem.types";

export interface IUser extends Document {
	publicId: string;
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

	comparePassword(candidatePassword: string): Promise<boolean>;
	canViewPost(post: Pick<IPost, "canBeViewedBy" | "user" | "author">): boolean;
}

// Create a user lookup map using publicId
export type UserLookupData = Pick<IUser, "publicId" | "username"> & Partial<Pick<IUser, "handle" | "avatar">>;

/** Shape returned by user suggestion aggregation queries */
export type UserSuggestion = Pick<IUser, "publicId" | "handle" | "username" | "avatar"> & {
	bio?: string;
	followerCount: NonNullable<IUser["followerCount"]>;
	postCount: NonNullable<IUser["postCount"]>;
	totalLikes: number;
	score: number;
};
