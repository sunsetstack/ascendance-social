import { FeedPost, IPost, PostDTO } from "@/types";
import {
  asCommunityPublicId,
  asImagePublicId,
  asPostPublicId,
  asUserPublicId,
  UserPublicId,
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

  const image =
    post.image?.url && post.image?.publicId
      ? {
          url: post.image.url,
          publicId: asImagePublicId(post.image.publicId),
          width: post.image.width,
          height: post.image.height,
        }
      : null;

  const url = post.image?.url ?? undefined;
  const imagePublicId = post.image?.publicId
    ? asImagePublicId(post.image.publicId)
    : undefined;

  return {
    publicId: asPostPublicId(post.publicId),
    body: post.body,
    slug: post.slug,
    type: post.type === "repost" || repostOf ? "repost" : "original",
    repostCount: post.repostCount ?? 0,
    repostOf,
    image,
    url,
    imagePublicId,
    tags,
    likes: post.likes,
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
  const rawObj = (post.toObject ? post.toObject() : post) as Record<
    string,
    unknown
  >;

  const tags = Array.isArray(rawObj.tags)
    ? (rawObj.tags as unknown[]).map((tag: unknown) => {
        if (typeof tag === "string") return tag;
        if (tag && typeof tag === "object" && "tag" in tag) {
          return String((tag as { tag: unknown }).tag);
        }
        return "";
      })
    : [];

  const imageRef = rawObj.image as unknown;
  const imageData =
    imageRef && typeof imageRef === "object" && !("_bsontype" in imageRef)
      ? (imageRef as { url?: string; publicId?: string; width?: number; height?: number })
      : null;
  const url = imageData?.url ?? undefined;
  const imagePublicId = imageData?.publicId
    ? asImagePublicId(imageData.publicId)
    : undefined;
  const image = url && imagePublicId
    ? { url, publicId: imagePublicId, width: imageData?.width, height: imageData?.height }
    : null;

  const userSnapshot = resolveIPostUserSnapshot(rawObj);
  const repostOf = buildIPostRepostOf(rawObj);

  const communityRef = (rawObj.communityId ?? rawObj.community) as unknown;
  const community =
    communityRef &&
    typeof communityRef === "object" &&
    !("_bsontype" in communityRef)
      ? buildCommunityFromRef(
          communityRef as {
            publicId?: string;
            name?: string;
            slug?: string;
            avatar?: string;
          },
        )
      : null;

  return {
    publicId: asPostPublicId(rawObj.publicId as string),
    body: rawObj.body as string | undefined,
    slug: rawObj.slug as string | undefined,
    type: (rawObj.type as "original" | "repost") ?? "original",
    repostCount: (rawObj.repostCount as number) ?? 0,
    repostOf,
    image,
    url,
    imagePublicId,
    tags: tags.filter(Boolean),
    likes: (rawObj.likesCount as number) ?? 0,
    commentsCount: (rawObj.commentsCount as number) ?? 0,
    viewsCount: (rawObj.viewsCount as number) ?? 0,
    createdAt: rawObj.createdAt as Date,
    user: userSnapshot,
    community,
  };
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

  const image =
    repost.image?.url && repost.image?.publicId
      ? {
          url: repost.image.url,
          publicId: asImagePublicId(repost.image.publicId),
          width: repost.image.width,
          height: repost.image.height,
        }
      : null;

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

function buildCommunityFromRef(source: {
  publicId?: string;
  name?: string;
  slug?: string;
  avatar?: string;
}): PostDTO["community"] {
  if (!source.publicId) return null;
  return {
    publicId: asCommunityPublicId(source.publicId),
    name: source.name ?? "",
    slug: source.slug ?? "",
    avatar: source.avatar,
  };
}

function resolveIPostUserSnapshot(rawObj: Record<string, unknown>): {
  publicId: UserPublicId;
  handle: string;
  username: string;
  avatar: string;
} {
  const userRef = rawObj.user;
  if (userRef && typeof userRef === "object" && !("_bsontype" in userRef)) {
    const user = userRef as {
      publicId?: string;
      handle?: string;
      username?: string;
      avatar?: string;
    };
    if (user.publicId) {
      return {
        publicId: asUserPublicId(user.publicId),
        handle: user.handle ?? "",
        username: user.username ?? "",
        avatar: user.avatar ?? "",
      };
    }
  }

  const author = (rawObj.author ?? {}) as {
    publicId?: string;
    handle?: string;
    username?: string;
    displayName?: string;
    avatarUrl?: string;
  };
  return {
    publicId: asUserPublicId(author.publicId ?? ""),
    handle: author.handle ?? "",
    username: author.username ?? author.displayName ?? "",
    avatar: author.avatarUrl ?? "",
  };
}

function buildIPostRepostOf(rawObj: Record<string, unknown>): PostDTO["repostOf"] {
  const repostRef = rawObj.repostOf;
  if (
    !repostRef ||
    typeof repostRef !== "object" ||
    "_bsontype" in repostRef
  ) {
    return undefined;
  }

  const repost = repostRef as {
    publicId?: string;
    body?: string;
    slug?: string;
    likesCount?: number;
    repostCount?: number;
    commentsCount?: number;
    author?: {
      publicId?: string;
      handle?: string;
      username?: string;
      displayName?: string;
      avatarUrl?: string;
    };
    image?: { url?: string; publicId?: string; width?: number; height?: number } | null;
  };

  if (!repost.publicId) return undefined;

  const image =
    repost.image?.url && repost.image?.publicId
      ? {
          url: repost.image.url,
          publicId: asImagePublicId(repost.image.publicId),
          width: repost.image.width,
          height: repost.image.height,
        }
      : null;

  return {
    publicId: asPostPublicId(repost.publicId),
    user: {
      publicId: asUserPublicId(repost.author?.publicId ?? ""),
      handle: repost.author?.handle ?? "",
      username: repost.author?.username ?? repost.author?.displayName ?? "",
      avatar: repost.author?.avatarUrl ?? "",
    },
    body: repost.body,
    slug: repost.slug,
    image,
    likes: repost.likesCount ?? 0,
    repostCount: repost.repostCount ?? 0,
    commentsCount: repost.commentsCount ?? 0,
  };
}
