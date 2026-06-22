import { IPost, IUser } from "@/types";

type PostViewSubject = Pick<IUser, "_id" | "publicId" | "isAdmin" | "isBanned">;
type ViewablePost = Pick<IPost, "user" | "author">;

export function isPostOwnedBy(
  post: ViewablePost,
  userId: { toString(): string } | string,
): boolean {
  const owner = post.user ?? post.author?._id;
  if (!owner) {
    return false;
  }

  return owner.toString() === userId.toString();
}

export function canPostBeViewedBy(
  post: ViewablePost,
  user?: PostViewSubject | null,
): boolean {
  if (!user) {
    return true;
  }

  const ownerId = user._id ?? user.publicId;
  const isOwner = ownerId ? isPostOwnedBy(post, ownerId) : false;

  if (user.isAdmin) {
    return true;
  }

  if (user.isBanned && !isOwner) {
    return false;
  }

  return true;
}
