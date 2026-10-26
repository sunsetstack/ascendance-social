import { FeedPost, IPost, PostDTO } from "@/types";
import type { PostCommunityRead, PostImageRead, PostReadSource } from "@/types";
import {
  asCommunityPublicId,
  asImagePublicId,
  asPostPublicId,
  asUserPublicId,
} from "@/types/branded";

export function toPostDTO(post: IPost | FeedPost): PostDTO {
  if (isFeedPost(post)) {
    return feedPostToDTO(post);
  }
  return iPostToDTO(post);
}

function isFeedPost(post: IPost | FeedPost): post is FeedPost {
  return "userPublicId" in post;
}

function feedPostToDTO(post: FeedPost): PostDTO {
  const tags = post.tags.map((tag) => tag.tag).filter(Boolean);
  const repostOf = buildFeedPostRepostOf(post.repostOf);

  const image = buildImageDTO(post.image);

  const url = post.image?.url ?? undefined;
  const imagePublicId = post.image?.publicId
    ? asImagePublicId(post.image.publicId)
    : undefined;

  return {
    publicId: asPostPublicId(post.publicId),
    body: post.body,
    editedAt: post.editedAt,
    slug: post.slug,
    type: post.type === "repost" || repostOf ? "repost" : "original",
    repostCount: post.repostCount ?? 0,
    repostOf,
    image,
    url,
    imagePublicId,
    tags,
    likes: post.likes,
    isLikedByViewer: post.isLikedByViewer,
    isRepostedByViewer: post.isRepostedByViewer,
    commentsCount: post.commentsCount,
    viewsCount: post.viewsCount,
    createdAt: post.createdAt,
    user: {
      publicId: asUserPublicId(post.user.publicId),
      handle: post.user.handle,
      username: post.user.username,
      avatar: post.user.avatar,
    },
    community: buildFeedPostCommunity(post.community),
  };
}

function iPostToDTO(post: IPost): PostDTO {
  const rawObj: PostReadSource = post.toObject ? post.toObject() : post;

  const tags = Array.isArray(rawObj.tags)
    ? rawObj.tags.map((tag) => {
        if (typeof tag === "string") return tag;
        if (tag && typeof tag === "object" && "tag" in tag) {
          return String(tag.tag);
        }
        return "";
      })
    : [];

  const imageRef = rawObj.image;
  const imageData =
    imageRef && typeof imageRef === "object" && !("_bsontype" in imageRef)
      ? imageRef
      : null;
  const url = imageData?.url ?? undefined;
  const imagePublicId = imageData?.publicId
    ? asImagePublicId(imageData.publicId)
    : undefined;
  const image = buildImageDTO(imageData);

  const userSnapshot = resolveIPostUserSnapshot(rawObj);
  const repostOf = buildIPostRepostOf(rawObj);

  const communityRef = rawObj.communityId ?? rawObj.community;
  const community =
    communityRef &&
    typeof communityRef === "object" &&
    !("_bsontype" in communityRef)
      ? buildCommunityFromRef(communityRef)
      : null;

  return {
    publicId: asPostPublicId(rawObj.publicId),
    body: rawObj.body,
    editedAt: rawObj.editedAt,
    slug: rawObj.slug,
    type: rawObj.type ?? "original",
    repostCount: rawObj.repostCount ?? 0,
    repostOf,
    image,
    url,
    imagePublicId,
    tags: tags.filter(Boolean),
    likes: rawObj.likesCount ?? 0,
    commentsCount: rawObj.commentsCount ?? 0,
    viewsCount: rawObj.viewsCount ?? 0,
    createdAt: rawObj.createdAt,
    user: userSnapshot,
    community,
  };
}

function buildImageDTO(image: PostImageRead | null | undefined): PostDTO["image"] {
  return image?.url && image.publicId
    ? {
        url: image.url,
        publicId: asImagePublicId(image.publicId),
        width: image.width,
        height: image.height,
      }
    : null;
}

function buildFeedPostCommunity(
  community: FeedPost["community"],
): PostDTO["community"] {
  if (!community?.publicId || !community.name || !community.slug) return null;
  return {
    publicId: asCommunityPublicId(community.publicId),
    name: community.name,
    slug: community.slug,
    avatar: community.avatar,
  };
}

function buildFeedPostRepostOf(
  repost: FeedPost["repostOf"],
): PostDTO["repostOf"] {
  if (!repost?.publicId) return undefined;

  const image = buildImageDTO(repost.image);

  return {
    publicId: asPostPublicId(repost.publicId),
    user: {
      publicId: asUserPublicId(repost.user?.publicId ?? ""),
      handle: repost.user?.handle ?? "",
      username: repost.user?.username ?? "",
      avatar: repost.user?.avatar ?? "",
    },
    body: repost.body,
    slug: repost.slug,
    image,
    likes: repost.likes ?? repost.likesCount ?? 0,
    repostCount: repost.repostCount ?? 0,
    commentsCount: repost.commentsCount ?? 0,
  };
}

function buildCommunityFromRef(source: PostCommunityRead): PostDTO["community"] {
  if (!source.publicId) return null;
  return {
    publicId: asCommunityPublicId(source.publicId),
    name: source.name ?? "",
    slug: source.slug ?? "",
    avatar: source.avatar,
  };
}

function resolveIPostUserSnapshot(rawObj: PostReadSource): PostDTO["user"] {
  const userRef = rawObj.user;
  if (userRef && typeof userRef === "object" && !("_bsontype" in userRef)) {
    if (userRef.publicId) {
      return {
        publicId: asUserPublicId(userRef.publicId),
        handle: userRef.handle ?? "",
        username: userRef.username ?? "",
        avatar: userRef.avatar ?? "",
      };
    }
  }

  return buildAuthorSnapshotDTO(rawObj.author);
}

function buildAuthorSnapshotDTO(author: PostReadSource["author"]): PostDTO["user"] {
  return {
    publicId: asUserPublicId(author?.publicId ?? ""),
    handle: author?.handle ?? "",
    username: author?.username ?? author?.displayName ?? "",
    avatar: author?.avatarUrl ?? "",
  };
}

function buildIPostRepostOf(rawObj: PostReadSource): PostDTO["repostOf"] {
  const repost = rawObj.repostOf;
  if (
    !repost ||
    typeof repost !== "object" ||
    "_bsontype" in repost
  ) {
    return undefined;
  }

  if (!repost.publicId) return undefined;

  const image = buildImageDTO(repost.image);

  return {
    publicId: asPostPublicId(repost.publicId),
    user: buildAuthorSnapshotDTO(repost.author),
    body: repost.body,
    slug: repost.slug,
    image,
    likes: repost.likesCount ?? 0,
    repostCount: repost.repostCount ?? 0,
    commentsCount: repost.commentsCount ?? 0,
  };
}
