import { IPost, PopulatedPostUser, PopulatedPostTag } from "@/types";
import { Types } from "mongoose";

/**
 * Shared constants for controller response handling.
 */
export const STREAM_THRESHOLD = 100;

/**
 * Extracts tag name strings from a post's tags array,
 * handling both populated tag objects and raw ObjectIds.
 */
export function extractTagNames(
  tags: IPost["tags"] | undefined,
): string[] {
  if (!Array.isArray(tags)) return [];
  return (tags as (Types.ObjectId | PopulatedPostTag)[]).map((t) =>
    typeof t === "object" && "tag" in t
      ? (t as PopulatedPostTag).tag
      : t.toString(),
  );
}

/**
 * Builds a short text preview of a post for use in notifications.
 */
export function buildPostPreview(post: IPost): string {
  if (post.body) {
    return post.body.substring(0, 50) + (post.body.length > 50 ? "..." : "");
  }
  return post.image ? "[Image post]" : "[Post]";
}

/**
 * Extracts owner identification from a post's `user` field,
 * which may be a raw ObjectId or a populated user document.
 */
export function extractPostOwnerInfo(post: IPost): {
  ownerInternalId: string;
  ownerPublicId?: string;
} {
  const rawUser = post.user as Types.ObjectId | PopulatedPostUser;
  const authorSnapshot = post.author;

  let ownerInternalId = "";
  if (typeof rawUser === "object" && "_id" in rawUser) {
    ownerInternalId = (rawUser as PopulatedPostUser)._id?.toString() ?? "";
  } else if (authorSnapshot?._id) {
    ownerInternalId = authorSnapshot._id.toString();
  } else if (rawUser) {
    ownerInternalId = rawUser.toString();
  }

  const ownerPublicId =
    typeof rawUser === "object" && "publicId" in rawUser
      ? (rawUser as PopulatedPostUser).publicId
      : authorSnapshot?.publicId;

  return { ownerInternalId, ownerPublicId };
}
