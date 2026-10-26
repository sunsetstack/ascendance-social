import mongoose, { Document } from "mongoose";
import { IImage } from "@/types/customImages/images.types";
import type { ContentFeatures } from "@/services/feed/interests.policy";
import {
  MongoId,
  UserPublicId,
  PostPublicId,
  TagPublicId,
} from "@/types/branded";

export interface IPost extends Document {
  publicId: PostPublicId;
  user: mongoose.Types.ObjectId;
  author: {
    _id: mongoose.Types.ObjectId;
    publicId: UserPublicId;
    handle: string;
    username: string;
    avatarUrl?: string;
    displayName?: string;
  };
  body?: string;
  editedAt?: Date;
  contentFeatures?: ContentFeatures;
  slug?: string;
  type: "original" | "repost";
  status: PostStatus;
  failureReason?: string;
  repostOf?: mongoose.Types.ObjectId | null;
  repostCount: number;
  image?: mongoose.Types.ObjectId | null;
  tags: mongoose.Types.ObjectId[];
  likesCount: number;
  commentsCount: number;
  viewsCount: number;
  createdAt: Date;
  updatedAt: Date;
  communityId?: mongoose.Types.ObjectId; // if null -> personal post otherwise it' a community post
}

export type PostStatus = "pending" | "active" | "failed";

export interface CreatePostAttachmentInput {
  filePath: string;
  originalName: string;
  userInternalId: MongoId;
  userPublicId: UserPublicId;
}

export interface AttachmentSummary {
  docId: mongoose.Types.ObjectId | null;
  publicId?: string;
  url?: string;
  slug?: string;
  width?: number;
  height?: number;
}

export interface AttachmentCreationResult {
  imageDoc: IImage | null;
  storagePublicId: string | null;
  summary: AttachmentSummary;
}

export interface RemoveAttachmentInput {
  imageId: string;
  requesterPublicId: UserPublicId;
  ownerInternalId?: MongoId;
  ownerPublicId?: UserPublicId;
}

export interface RemoveAttachmentResult {
  removed: boolean;
  removedPublicId?: string;
  removedUrl?: string;
}

export interface RemoveAttachmentRecordInput {
  imageId: string;
}

export interface RemoveAttachmentRecordResult {
  removed: boolean;
  removedPublicId?: string;
  removedUrl?: string;
}

export interface DeleteAttachmentAssetInput {
  requesterPublicId: UserPublicId;
  ownerPublicId: UserPublicId;
  url: string;
}

export interface IPostWithId extends IPost {
  _id: mongoose.Types.ObjectId;
}

export type PopulatedPostUser = {
  _id?: mongoose.Types.ObjectId;
  publicId?: UserPublicId;
  username?: string;
  handle?: string;
  avatar?: string;
};

export type PopulatedPostTag = {
  _id?: mongoose.Types.ObjectId;
  tag: string;
  publicId?: TagPublicId;
};

export interface PostImageRead {
  publicId?: string;
  url?: string;
  width?: number;
  height?: number;
}

export interface PostCommunityRead {
  publicId?: string;
  name?: string;
  slug?: string;
  avatar?: string;
}

export type PopulatedRepostRead = Pick<
  IPost,
  | "publicId"
  | "body"
  | "slug"
  | "likesCount"
  | "repostCount"
  | "commentsCount"
  | "author"
> & {
  image?: PostImageRead | null;
};

export type PostReadSource = Pick<
  IPost,
  | "publicId"
  | "body"
  | "editedAt"
  | "slug"
  | "type"
  | "repostCount"
  | "likesCount"
  | "commentsCount"
  | "viewsCount"
  | "createdAt"
> & {
  user?: mongoose.Types.ObjectId | PopulatedPostUser;
  author?: Partial<IPost["author"]>;
  tags: (mongoose.Types.ObjectId | PopulatedPostTag | string)[];
  image?: mongoose.Types.ObjectId | PostImageRead | null;
  repostOf?: mongoose.Types.ObjectId | PopulatedRepostRead | null;
  communityId?: mongoose.Types.ObjectId | PostCommunityRead | null;
  community?: PostCommunityRead | null;
};
