import { UserPublicId, PostPublicId, MongoId } from "@/types/branded";
import mongoose, { Document } from "mongoose";
import { Types } from "mongoose";

export type CommentDeletionReason =
  | "comment_removed"
  | "account_deleted"
  | "account_banned";

export interface IComment extends Document {
  _id: mongoose.Types.ObjectId;
  content: string;
  postId: mongoose.Types.ObjectId;
  parentId: mongoose.Types.ObjectId | null;
  replyCount: number;
  depth: number;
  likesCount: number;
  userId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  isDeleted: boolean;
  deletedBy: "user" | "admin" | null;
  deletionReason?: CommentDeletionReason | null;
  departedUserKey?: string;
}

export interface CommentCreateDto {
  content: string;
  postId: MongoId;
  userId: MongoId;
}

export interface CommentUpdateDto {
  content: string;
}

export interface CommentResponseDto {
  id: string;
  content: string;
  postId: string;
  parentId: string | null;
  replyCount: number;
  depth: number;
  likesCount: number;
  user: {
    id: string;
    username: string;
    avatar?: string;
  };
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
}

export interface CommentsPaginationResponse {
  comments: CommentResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TransformedComment {
  id: string;
  content: string;
  postPublicId: PostPublicId;
  parentId: string | null;
  replyCount: number;
  depth: number;
  likesCount: number;
  user: {
    publicId: UserPublicId;
    handle: string;
    username: string;
    avatar?: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  isDeleted: boolean;
  deletedBy: "user" | "admin" | null;
  deletionReason?: CommentDeletionReason | null;
}

// interface for populated comment from lean() query
export interface PopulatedCommentLean {
  _id: Types.ObjectId;
  content: string;
  postId: { publicId: PostPublicId };
  parentId: Types.ObjectId | null;
  replyCount: number;
  depth: number;
  likesCount: number;
  userId: {
    publicId: UserPublicId;
    handle?: string;
    username: string;
    avatar?: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  isDeleted: boolean;
  deletedBy: "user" | "admin" | null;
  deletionReason?: CommentDeletionReason | null;
}
