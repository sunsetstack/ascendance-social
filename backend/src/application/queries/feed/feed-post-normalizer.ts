import { FeedPost, IImage, IPost, ITag, UserLookupData } from "@/types";
import { asUserPublicId } from "@/types/branded";

type FeedPostSource = IPost | FeedPost | Record<string, unknown>;

type UserSnapshot = Partial<UserLookupData> & {
  avatarUrl?: string;
};

function toPlainRecord(post: FeedPostSource): Record<string, unknown> {
  const maybeDocument = post as IPost;
  return typeof maybeDocument.toObject === "function"
    ? (maybeDocument.toObject() as Record<string, unknown>)
    : (post as Record<string, unknown>);
}

function normalizeTags(tags: unknown): { tag: string; publicId?: string }[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags.reduce<{ tag: string; publicId?: string }[]>((acc, tag) => {
    if (typeof tag === "string") {
      acc.push({ tag });
      return acc;
    }

    if (tag && typeof tag === "object") {
      if ("tag" in tag) {
        acc.push({
          tag: (tag as { tag: string }).tag,
          publicId: (tag as { publicId?: string }).publicId,
        });
      } else {
        acc.push({ tag: (tag as ITag).tag });
      }
    }

    return acc;
  }, []);
}

function normalizeImage(image: unknown): FeedPost["image"] {
  if (!image || typeof image !== "object") {
    return undefined;
  }

  const imageDoc = image as IImage | Record<string, unknown>;
  return {
    publicId: imageDoc.publicId as string,
    url: imageDoc.url as string,
    slug: imageDoc.slug as string,
  };
}

function getUserSnapshot(post: Record<string, unknown>): UserSnapshot {
  const rawUser = post.user;
  if (
    rawUser &&
    typeof rawUser === "object" &&
    ("publicId" in rawUser || "username" in rawUser)
  ) {
    return rawUser as UserSnapshot;
  }

  const author = post.author;
  return author && typeof author === "object" ? (author as UserSnapshot) : {};
}

function normalizeRepostOf(repostOf: unknown): FeedPost["repostOf"] {
  if (!repostOf || typeof repostOf !== "object") {
    return undefined;
  }

  const repost = toPlainRecord(repostOf as FeedPostSource);
  const originalUser = getUserSnapshot(repost);

  return {
    publicId: repost.publicId as string,
    body: (repost.body as string) ?? "",
    slug: (repost.slug as string) ?? "",
    likes: ((repost.likesCount ?? repost.likes) as number) ?? 0,
    repostCount: (repost.repostCount as number) ?? 0,
    commentsCount: (repost.commentsCount as number) ?? 0,
    user: {
      publicId: originalUser.publicId as string,
      handle: originalUser.handle ?? "",
      username: originalUser.username as string,
      avatar: originalUser.avatar ?? originalUser.avatarUrl ?? "",
    },
    image: normalizeImage(repost.image),
  };
}

export function normalizeFeedPost(post: FeedPostSource): FeedPost {
  const plainPost = toPlainRecord(post);
  const user = getUserSnapshot(plainPost);
  const repostOf = normalizeRepostOf(plainPost.repostOf);

  return {
    publicId: plainPost.publicId as string,
    body: (plainPost.body as string) ?? "",
    slug: (plainPost.slug as string) ?? "",
    type:
      plainPost.type === "repost" || repostOf ? "repost" : "original",
    repostCount: (plainPost.repostCount as number) ?? 0,
    repostOf,
    createdAt: plainPost.createdAt as Date,
    likes: ((plainPost.likesCount ?? plainPost.likes) as number) ?? 0,
    commentsCount: (plainPost.commentsCount as number) ?? 0,
    viewsCount: (plainPost.viewsCount as number) ?? 0,
    userPublicId: asUserPublicId(user.publicId as string),
    tags: normalizeTags(plainPost.tags),
    user: {
      publicId: user.publicId as string,
      handle: user.handle ?? "",
      username: user.username as string,
      avatar: user.avatar ?? user.avatarUrl ?? "",
    },
    image: normalizeImage(plainPost.image),
    community: (plainPost.community as FeedPost["community"]) ?? undefined,
    rankScore: plainPost.rankScore as number | undefined,
    trendScore: plainPost.trendScore as number | undefined,
    isPersonalized: plainPost.isPersonalized as boolean | undefined,
  };
}

export function normalizeFeedPosts(posts: FeedPostSource[]): FeedPost[] {
  return posts.map(normalizeFeedPost);
}
