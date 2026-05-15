import mongoose, { Document } from "mongoose";
import { IImage } from "@/types/customImages/images.types";
import { IUser } from "../customUsers/user.types";
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
  slug?: string;
  type: "original" | "repost";
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
  isOwnedBy(userId: mongoose.Types.ObjectId | string): boolean;
  canBeViewedBy(
    user?: Pick<IUser, "isAdmin" | "isBanned" | "publicId"> | null,
  ): boolean;
}

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
