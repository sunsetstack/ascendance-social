import mongoose from "mongoose";
import { IPost } from "@/types";

type MaybePopulatedObjectId =
  | mongoose.Types.ObjectId
  | { _id: mongoose.Types.ObjectId }
  | null
  | undefined;

export function getObjectIdString(value: MaybePopulatedObjectId): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  return value._id?.toString() ?? null;
}

export function getAuthorInternalId(post: IPost): string | null {
  const authorId = post.author?._id;
  if (authorId) {
    return authorId.toString();
  }

  return getObjectIdString(post.user as MaybePopulatedObjectId);
}

export function getCommunityInternalId(post: IPost): string | null {
  return getObjectIdString(post.communityId as MaybePopulatedObjectId);
}

export function getRepostTargetId(
  post: IPost,
  fallbackPostInternalId: string,
): string {
  return (
    getObjectIdString(post.repostOf as MaybePopulatedObjectId) ??
    fallbackPostInternalId
  );
}
