import { injectable } from "tsyringe";
import {
  IUser,
  IMessage,
  IMessageAttachment,
  MessageDTO,
  PostDTO,
  IPost,
  FeedPost,
  IMessagePopulated,
  ICommunity,
  ICommunityMember,
} from "@/types";
import {
  UserPublicId,
  CommunityPublicId,
  asUserPublicId,
  asPostPublicId,
  asImagePublicId,
  asCommunityPublicId,
} from "@/types/branded";

export interface PublicUserDTO {
  publicId: UserPublicId;
  handle: string;
  username: string;
  avatar: string;
  cover: string;
  bio: string;
  createdAt: Date;
  postCount: number;
  followerCount: number;
  followingCount: number;
}

export interface HandleSuggestionDTO {
  publicId: UserPublicId;
  handle: string;
  username: string;
  avatar: string;
}

export interface AuthenticatedUserDTO extends PublicUserDTO {
  email: string;
  isEmailVerified: boolean;
}

// sensitive account info for settings page (not exposed to other users)
export interface AccountInfoDTO {
  publicId: UserPublicId;
  handle: string;
  username: string;
  email: string;
  isEmailVerified: boolean;
  createdAt: Date;
  registrationIp?: string;
}

export interface AdminUserDTO extends AuthenticatedUserDTO {
  isAdmin: boolean;
  isBanned: boolean;
  bannedAt?: Date;
  bannedReason?: string;
  bannedBy?: string;
  updatedAt: Date;
  registrationIp?: string;
  lastActive?: Date;
  lastIp?: string;
}

export interface CommunityDTO {
  publicId: CommunityPublicId;
  name: string;
  slug: string;
  description: string;
  avatar?: string;
  coverPhoto?: string;
  stats: {
    memberCount: number;
    postCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
  isMember?: boolean;
  isCreator?: boolean;
  isAdmin?: boolean;
}

export interface CommunityMemberDTO {
  userId: {
    publicId: string;
    handle: string;
    username: string;
    avatar?: string;
  };
  role: "admin" | "moderator" | "member";
  joinedAt: Date;
}

@injectable()
export class DTOService {
  /**
   * Converts a post document or aggregation result to PostDTO.
   *
   * Accepts two distinct input shapes:
   * - FeedPost: a plain aggregation result with resolved user, tags, image, and community.
   * - IPost: a Mongoose Document with author snapshot and ObjectId references.
   *
   * Each path reads directly from the typed input without internal assertions.
   */
  toPostDTO(post: IPost | FeedPost): PostDTO {
    if (this.isFeedPost(post)) {
      return this.feedPostToDTO(post);
    }
    return this.iPostToDTO(post);
  }

  /**
   * Discriminator: FeedPost has `userPublicId` set by the aggregation projection.
   * IPost (Mongoose Document) does not have this field.
   */
  private isFeedPost(post: IPost | FeedPost): post is FeedPost {
    return "userPublicId" in post;
  }

  /**
   * Maps a FeedPost (plain aggregation result) to PostDTO.
   * All fields on FeedPost are already resolved — no secondary lookups needed.
   */
  private feedPostToDTO(post: FeedPost): PostDTO {
    const tags = post.tags.map((t) => t.tag).filter(Boolean);

    const image =
      post.image?.url && post.image?.publicId
        ? {
            url: post.image.url,
            publicId: asImagePublicId(post.image.publicId),
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
      type: "original",
      repostCount: 0,
      repostOf: undefined,
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
      community: this.buildFeedPostCommunity(post.community),
    };
  }

  /**
   * Maps an IPost Mongoose Document to PostDTO.
   * Reads from the embedded author snapshot and resolves ObjectId-based fields
   * that may be populated by the caller.
   */
  private iPostToDTO(post: IPost): PostDTO {
    // post.toObject() has a narrow return type in Mongoose that does not include
    // schema fields. We cast once here at the Mongoose boundary to access all
    // document fields. This is the correct single-point-of-cast pattern.
    const rawObj = (post.toObject ? post.toObject() : post) as Record<
      string,
      unknown
    >;

    // Tags may be populated objects or raw ObjectIds from the schema
    const tags = Array.isArray(rawObj.tags)
      ? (rawObj.tags as unknown[]).map((tag: unknown) => {
          if (typeof tag === "string") return tag;
          if (tag && typeof tag === "object" && "tag" in tag)
            return String((tag as { tag: unknown }).tag);
          return "";
        })
      : [];

    // Image may be a populated object when the caller uses .populate("image")
    const imageRef = rawObj.image as unknown;
    const imageData =
      imageRef && typeof imageRef === "object" && !("_bsontype" in imageRef)
        ? (imageRef as { url?: string; publicId?: string })
        : null;
    const url = imageData?.url ?? undefined;
    const imagePublicId = imageData?.publicId
      ? asImagePublicId(imageData.publicId)
      : undefined;
    const image =
      url && imagePublicId ? { url, publicId: imagePublicId } : null;

    const userSnapshot = this.resolveIPostUserSnapshot(rawObj);

    const repostOf = this.buildIPostRepostOf(rawObj);

    const communityRef = (rawObj.communityId ?? rawObj.community) as unknown;
    const community =
      communityRef &&
      typeof communityRef === "object" &&
      !("_bsontype" in communityRef)
        ? this.buildCommunityFromRef(
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

  private buildFeedPostCommunity(
    community: FeedPost["community"],
  ): PostDTO["community"] {
    if (!community) return null;
    return {
      publicId: asCommunityPublicId(community.publicId),
      name: community.name,
      slug: community.slug,
      avatar: community.avatar,
    };
  }

  private buildCommunityFromRef(source: {
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

  private resolveIPostUserSnapshot(rawObj: Record<string, unknown>): {
    publicId: UserPublicId;
    handle: string;
    username: string;
    avatar: string;
  } {
    // Prefer a populated user object (when caller uses .populate("user"))
    const userRef = rawObj.user;
    if (userRef && typeof userRef === "object" && !("_bsontype" in userRef)) {
      const u = userRef as {
        publicId?: string;
        handle?: string;
        username?: string;
        avatar?: string;
      };
      if (u.publicId) {
        return {
          publicId: asUserPublicId(u.publicId),
          handle: u.handle ?? "",
          username: u.username ?? "",
          avatar: u.avatar ?? "",
        };
      }
    }

    // Fall back to the embedded author snapshot
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

  private buildIPostRepostOf(
    rawObj: Record<string, unknown>,
  ): PostDTO["repostOf"] {
    const repostRef = rawObj.repostOf;
    if (
      !repostRef ||
      typeof repostRef !== "object" ||
      "_bsontype" in repostRef
    ) {
      return undefined;
    }

    const r = repostRef as {
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
      image?: { url?: string; publicId?: string } | null;
    };

    if (!r.publicId) return undefined;

    const image =
      r.image?.url && r.image?.publicId
        ? { url: r.image.url, publicId: asImagePublicId(r.image.publicId) }
        : null;

    return {
      publicId: asPostPublicId(r.publicId),
      user: {
        publicId: asUserPublicId(r.author?.publicId ?? ""),
        handle: r.author?.handle ?? "",
        username: r.author?.username ?? r.author?.displayName ?? "",
        avatar: r.author?.avatarUrl ?? "",
      },
      body: r.body,
      slug: r.slug,
      image,
      likes: r.likesCount ?? 0,
      repostCount: r.repostCount ?? 0,
      commentsCount: r.commentsCount ?? 0,
    };
  }

  /**
   * Normalizes an unknown candidate object into a user snapshot shape.
   * Used for community member population and similar populated references.
   */
  private normalizeUserLike(candidate: unknown): {
    publicId: string;
    handle: string;
    username: string;
    avatar: string;
  } | null {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }
    const c = candidate as Record<string, unknown>;

    const publicId = this.pickString(c.publicId ?? c.userPublicId ?? c.id);
    if (!publicId) {
      return null;
    }

    return {
      publicId,
      handle: this.pickString(c.handle) || "",
      username: this.pickString(c.username ?? c.displayName) || "",
      avatar:
        this.pickString(
          c.avatar ??
            c.avatarUrl ??
            (c.profile as Record<string, unknown>)?.avatarUrl,
        ) || "",
    };
  }

  private pickString(value: unknown): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
    return "";
  }
  toCommunityDTO(
    community: ICommunity,
    options?: {
      memberCount?: number;
      isMember?: boolean;
      isCreator?: boolean;
      isAdmin?: boolean;
    },
  ): CommunityDTO {
    const source = community?.toObject ? community.toObject() : community;
    const avatar = this.pickString(source?.avatar);
    const coverPhoto = this.pickString(source?.coverPhoto);
    const stats = source?.stats ?? {};

    return {
      publicId: asCommunityPublicId(this.pickString(source?.publicId)),
      name: this.pickString(source?.name),
      slug: this.pickString(source?.slug),
      description: this.pickString(source?.description),
      avatar: avatar || undefined,
      coverPhoto: coverPhoto || undefined,
      stats: {
        memberCount: options?.memberCount ?? stats.memberCount ?? 0,
        postCount: stats.postCount ?? 0,
      },
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      isMember: options?.isMember,
      isCreator: options?.isCreator,
      isAdmin: options?.isAdmin,
    };
  }

  toCommunityMemberDTO(member: ICommunityMember): CommunityMemberDTO {
    const userCandidate = (member as { userId?: unknown })?.userId;
    const userSnapshot = this.normalizeUserLike(userCandidate) ?? {
      publicId: "",
      handle: "",
      username: "",
      avatar: "",
    };

    return {
      userId: {
        publicId: userSnapshot.publicId,
        handle: userSnapshot.handle,
        username: userSnapshot.username,
        avatar: userSnapshot.avatar || undefined,
      },
      role: member.role,
      joinedAt: member.joinedAt,
    };
  }
  toPublicUserDTO(user: IUser, _viewerUserId?: string): PublicUserDTO {
    return {
      publicId: user.publicId,
      handle: user.handle,
      username: user.username,
      avatar: user.avatar,
      cover: user.cover,
      bio: user.bio,
      createdAt: user.createdAt,
      postCount: this.resolvePostCount(user),
      followerCount: this.resolveFollowerCount(user),
      followingCount: this.resolveFollowingCount(user),
    };
  }

  toHandleSuggestionDTO(user: IUser): HandleSuggestionDTO {
    const source = user?.toObject ? user.toObject() : user;
    return {
      publicId: asUserPublicId(this.pickString(source?.publicId)),
      handle: this.pickString(source?.handle),
      username: this.pickString(source?.username),
      avatar: this.pickString(source?.avatar),
    };
  }

  toAuthenticatedUserDTO(user: IUser): AuthenticatedUserDTO {
    return {
      ...this.toPublicUserDTO(user),
      email: user.email,
      isEmailVerified: user.isEmailVerified ?? false,
    };
  }

  toAccountInfoDTO(user: IUser): AccountInfoDTO {
    return {
      publicId: user.publicId,
      handle: user.handle,
      username: user.username,
      email: user.email,
      isEmailVerified: user.isEmailVerified ?? false,
      createdAt: user.createdAt,
      registrationIp: user.registrationIp,
    };
  }

  // Convenience methods with shorter names for backward compatibility
  toPublicDTO(user: IUser): PublicUserDTO {
    return this.toPublicUserDTO(user);
  }

  toAdminDTO(user: IUser): AdminUserDTO {
    return {
      ...this.toPublicUserDTO(user),
      email: user.email,
      isEmailVerified: user.isEmailVerified ?? false,
      isAdmin: user.isAdmin,
      isBanned: user.isBanned,
      bannedAt: user.bannedAt,
      bannedReason: user.bannedReason,
      bannedBy: user.bannedBy?.toString(),
      updatedAt: user.updatedAt,
      registrationIp: user.registrationIp,
      lastActive: user.lastActive,
      lastIp: user.lastIp,
    };
  }

  private resolvePostCount(user: IUser): number {
    if (typeof user.postCount === "number" && Number.isFinite(user.postCount)) {
      return user.postCount;
    }
    return 0;
  }

  private resolveFollowerCount(user: IUser): number {
    if (
      typeof user.followerCount === "number" &&
      Number.isFinite(user.followerCount)
    ) {
      return user.followerCount;
    }

    return 0;
  }

  private resolveFollowingCount(user: IUser): number {
    if (
      typeof user.followingCount === "number" &&
      Number.isFinite(user.followingCount)
    ) {
      return user.followingCount;
    }

    return 0;
  }

  toPublicMessageDTO(
    message: IMessage | IMessagePopulated,
    conversationPublicId: string,
  ): MessageDTO {
    const populatedMessage = message as IMessagePopulated;
    const sender = populatedMessage.sender || {};

    const readBy = Array.isArray(populatedMessage.readBy)
      ? populatedMessage.readBy.map((entry) => {
          if (!entry) return "";
          if (typeof entry === "string") return entry;
          if (
            typeof entry === "object" &&
            "publicId" in entry &&
            entry.publicId
          ) {
            return entry.publicId;
          }
          if (
            typeof entry === "object" &&
            typeof entry.toString === "function"
          ) {
            return entry.toString();
          }
          return String(entry);
        })
      : [];

    const attachments: IMessageAttachment[] = Array.isArray(message.attachments)
      ? message.attachments
      : [];

    const createdAtValue = message.createdAt;
    const createdAt =
      createdAtValue instanceof Date
        ? createdAtValue
        : new Date(createdAtValue);

    return {
      publicId: message.publicId,
      conversationId: conversationPublicId,
      body: message.body,
      sender: {
        publicId: sender?.publicId ?? "",
        handle: sender?.handle ?? "",
        username: sender?.username ?? "",
        avatar: sender?.avatar ?? "",
      },
      attachments,
      status: message.status,
      createdAt: createdAt.toISOString(),
      readBy: readBy.filter((value: string) => Boolean(value)),
    };
  }
}
