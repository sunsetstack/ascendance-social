import { ClientSession, Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import {
  AccountLifecycleAction,
  DEFAULT_ACCOUNT_AVATAR,
  UNAVAILABLE_MESSAGE_SENDER,
  accountLifecycleKey,
  commentTombstoneFor,
} from "@/application/common/policies/account-lifecycle.policy";
import { sessionALS } from "@/database/UnitOfWork";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import {
  ContentCleanupResult,
  ContentCleanupService,
  RemovedImageAsset,
  RemovedPostSummary,
} from "./content-cleanup.service";

type Db = mongo.Db;
type Document = mongo.Document;
type ObjectId = mongo.ObjectId;
const ObjectId = mongo.ObjectId;

interface UnavailableSnapshot extends Document {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  reason: "banned" | "deleted";
  unavailableAt: Date;
}

interface StoredUser extends Document {
  _id: ObjectId;
  publicId: string;
  email?: string;
  handle?: string;
  username?: string;
  avatar?: string;
  cover?: string;
  joinedCommunities?: Array<{ _id: ObjectId }>;
}

interface StoredMessage extends Document {
  sender?: ObjectId | null;
  senderSnapshot?: UnavailableSnapshot;
  readBy?: ObjectId[];
}

interface StoredConversation extends Document {
  _id: ObjectId;
  participants?: ObjectId[];
  departedParticipants?: UnavailableSnapshot[];
  isGroup?: boolean;
}

interface StoredCommunityMember extends Document {
  _id: ObjectId;
  communityId: ObjectId;
  userId: ObjectId;
  role?: "admin" | "moderator" | "member";
  joinedAt?: Date;
}

export interface AccountPurgeOptions {
  action: AccountLifecycleAction;
  reason: string;
  bannedBy?: ObjectId;
}

export interface AccountPurgeResult {
  deletedPosts: RemovedPostSummary[];
  imageAssets: RemovedImageAsset[];
  followerPublicIds: string[];
  affectedRelationshipPublicIds: string[];
  reconciledPostLikes: Array<{
    postPublicId: string;
    likesCount: number;
  }>;
  tombstonedCommentCount: number;
  preservedConversationCount: number;
}

const rolePriority: Record<string, number> = {
  admin: 0,
  moderator: 1,
  member: 2,
};

function uniqueObjectIds(values: Array<ObjectId | null | undefined>): ObjectId[] {
  return Array.from(
    new Map(
      values
        .filter((value): value is ObjectId => value instanceof ObjectId)
        .map((value) => [value.toHexString(), value]),
    ).values(),
  );
}

function appendCleanup(
  target: ContentCleanupResult,
  source: ContentCleanupResult,
): void {
  const knownPosts = new Set(target.posts.map((post) => post.internalId.toHexString()));
  for (const post of source.posts) {
    if (!knownPosts.has(post.internalId.toHexString())) {
      target.posts.push(post);
      knownPosts.add(post.internalId.toHexString());
    }
  }
  const knownAssets = new Set(
    target.imageAssets.flatMap((asset) =>
      [asset.storagePublicId, asset.url].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
  for (const asset of source.imageAssets) {
    const keys = [asset.storagePublicId, asset.url].filter(
      (value): value is string => Boolean(value),
    );
    if (keys.length > 0 && keys.every((key) => !knownAssets.has(key))) {
      target.imageAssets.push(asset);
      keys.forEach((key) => knownAssets.add(key));
    }
  }
}

@injectable()
export class AccountLifecycleService {
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.ContentCleanup)
    private readonly contentCleanupService: ContentCleanupService,
  ) {}

  async purgeUser(
    user: Pick<
      StoredUser,
      "_id" | "publicId" | "handle" | "username" | "avatar" | "cover"
    >,
    options: AccountPurgeOptions,
  ): Promise<AccountPurgeResult> {
    const session = this.requireSession();
    const db = this.db();
    const userId = new ObjectId(user._id.toString());
    const cleanup: ContentCleanupResult = { posts: [], imageAssets: [] };

    const followerPublicIds = await this.findFollowerPublicIds(userId, session);

    const userPostIds = await this.contentCleanupService.findPostIdsByUser(userId);
    appendCleanup(
      cleanup,
      await this.contentCleanupService.deletePostGraph(userPostIds),
    );

    const tombstonedCommentCount = await this.tombstoneComments(
      userId,
      user.publicId,
      options.action,
      session,
    );
    const reconciledPostLikes = await this.removePostInteractions(
      userId,
      session,
    );
    const affectedRelationshipPublicIds = await this.removeRelationshipData(
      userId,
      session,
    );
    await this.removeNotificationsAndActivity(
      userId,
      user.publicId,
      session,
    );

    const preservedConversationCount = await this.preserveConversations(
      user,
      options.action,
      session,
    );

    appendCleanup(
      cleanup,
      await this.removeCommunityMembershipsAndTransferOwnership(
        userId,
        session,
      ),
    );

    const remainingImages = await db
      .collection("images")
      .find({ user: userId }, { session })
      .toArray();
    if (remainingImages.length > 0) {
      await db
        .collection("images")
        .deleteMany({ user: userId }, { session });
      cleanup.imageAssets.push(
        ...remainingImages.map((image) => ({
          storagePublicId:
            typeof image.publicId === "string" ? image.publicId : undefined,
          url: typeof image.url === "string" ? image.url : undefined,
          ownerPublicId: user.publicId,
        })),
      );
    }

    this.addProfileAssets(cleanup.imageAssets, user);

    await db
      .collection("userpreferences")
      .deleteMany({ userId }, { session });

    if (options.action === "ban") {
      await db.collection("users").updateOne(
        { _id: userId },
        {
          $set: {
            isBanned: true,
            bannedAt: new Date(),
            bannedReason: options.reason,
            bannedBy: options.bannedBy,
            followerCount: 0,
            followingCount: 0,
            postCount: 0,
            joinedCommunities: [],
            bio: "",
            avatar: DEFAULT_ACCOUNT_AVATAR,
            cover: "",
          },
        },
        { session },
      );
    } else {
      await db.collection("users").deleteOne({ _id: userId }, { session });
    }

    return {
      deletedPosts: cleanup.posts,
      imageAssets: cleanup.imageAssets,
      followerPublicIds,
      affectedRelationshipPublicIds,
      reconciledPostLikes,
      tombstonedCommentCount,
      preservedConversationCount,
    };
  }

  private async tombstoneComments(
    userId: ObjectId,
    userPublicId: string,
    action: AccountLifecycleAction,
    session: ClientSession,
  ): Promise<number> {
    const db = this.db();
    const departedUserKey = accountLifecycleKey(userPublicId);
    const authoredComments = await db
      .collection("comments")
      .find(
        {
          $or: [{ userId }, { departedUserKey }],
        },
        { session, projection: { _id: 1 } },
      )
      .toArray();
    const authoredCommentIds = authoredComments.map(
      (comment) => comment._id as ObjectId,
    );
    const userCommentLikes = await db
      .collection("commentlikes")
      .find({ userId }, { session, projection: { commentId: 1 } })
      .toArray();
    const affectedCommentIds = uniqueObjectIds([
      ...authoredCommentIds,
      ...userCommentLikes.map((like) => like.commentId as ObjectId),
    ]);

    await db.collection("commentlikes").deleteMany(
      {
        $or: [
          { userId },
          ...(authoredCommentIds.length > 0
            ? [{ commentId: { $in: authoredCommentIds } }]
            : []),
        ],
      },
      { session },
    );
    await this.contentCleanupService.recomputeCommentLikeCounts(
      affectedCommentIds,
      session,
    );

    if (authoredCommentIds.length > 0) {
      await db.collection("comments").updateMany(
        { _id: { $in: authoredCommentIds } },
        {
          $set: {
            content: commentTombstoneFor(action),
            userId: null,
            isDeleted: true,
            deletedBy: action === "ban" ? "admin" : "user",
            deletionReason:
              action === "ban" ? "account_banned" : "account_deleted",
            departedUserKey,
            isEdited: false,
            likesCount: 0,
          },
        },
        { session },
      );
      const commentTargetIds = authoredCommentIds.map((id) => id.toHexString());
      await db
        .collection("notifications")
        .deleteMany({ targetId: { $in: commentTargetIds } }, { session });
      await db
        .collection("useractions")
        .deleteMany({ targetId: { $in: authoredCommentIds } }, { session });
    }

    await db.collection("notifications").deleteMany(
      {
        $or: [{ userId: userPublicId }, { actorId: userPublicId }],
      },
      { session },
    );

    return authoredCommentIds.length;
  }

  private async removePostInteractions(
    userId: ObjectId,
    session: ClientSession,
  ): Promise<Array<{ postPublicId: string; likesCount: number }>> {
    const db = this.db();
    const postLikes = await db
      .collection("postlikes")
      .find({ userId }, { session, projection: { postId: 1 } })
      .toArray();
    const affectedPostIds = uniqueObjectIds(
      postLikes.map((like) => like.postId as ObjectId),
    );
    await db.collection("postlikes").deleteMany({ userId }, { session });
    await this.contentCleanupService.recomputePostLikeCounts(
      affectedPostIds,
      session,
    );
    await db.collection("favorites").deleteMany({ userId }, { session });
    await db.collection("postviews").deleteMany({ user: userId }, { session });

    if (affectedPostIds.length === 0) return [];
    const posts = await db
      .collection("posts")
      .find(
        { _id: { $in: affectedPostIds } },
        { session, projection: { publicId: 1, likesCount: 1 } },
      )
      .toArray();
    return posts
      .filter((post) => typeof post.publicId === "string")
      .map((post) => ({
        postPublicId: post.publicId as string,
        likesCount: Number(post.likesCount ?? 0),
      }));
  }

  private async removeRelationshipData(
    userId: ObjectId,
    session: ClientSession,
  ): Promise<string[]> {
    const db = this.db();
    const follows = await db
      .collection("follows")
      .find(
        { $or: [{ followerId: userId }, { followeeId: userId }] },
        { session },
      )
      .toArray();
    const affectedUserIds = uniqueObjectIds(
      follows.flatMap((follow) => [
        follow.followerId as ObjectId,
        follow.followeeId as ObjectId,
      ]),
    ).filter((id) => !id.equals(userId));

    await db.collection("follows").deleteMany(
      { $or: [{ followerId: userId }, { followeeId: userId }] },
      { session },
    );

    for (const affectedUserId of affectedUserIds) {
      const followerCount = await db.collection("follows").countDocuments(
        { followeeId: affectedUserId },
        { session },
      );
      const followingCount = await db.collection("follows").countDocuments(
        { followerId: affectedUserId },
        { session },
      );
      await db.collection("users").updateOne(
        { _id: affectedUserId },
        { $set: { followerCount, followingCount } },
        { session },
      );
    }

    if (affectedUserIds.length === 0) return [];
    const affectedUsers = await db
      .collection<StoredUser>("users")
      .find(
        { _id: { $in: affectedUserIds } },
        { session, projection: { publicId: 1 } },
      )
      .toArray();
    return affectedUsers
      .map((affectedUser) => affectedUser.publicId)
      .filter(Boolean);
  }

  private async removeNotificationsAndActivity(
    userId: ObjectId,
    userPublicId: string,
    session: ClientSession,
  ): Promise<void> {
    const db = this.db();
    await db.collection("notifications").deleteMany(
      {
        $or: [
          { userId: userPublicId },
          { userId: userId.toHexString() },
          { actorId: userPublicId },
          { actorId: userId.toHexString() },
        ],
      },
      { session },
    );
    await db.collection("useractions").deleteMany(
      { $or: [{ userId }, { targetId: userId }] },
      { session },
    );
  }

  private async preserveConversations(
    user: Pick<StoredUser, "_id" | "publicId" | "handle" | "avatar">,
    action: AccountLifecycleAction,
    session: ClientSession,
  ): Promise<number> {
    const db = this.db();
    const userId = new ObjectId(user._id.toString());
    const unavailableAt = new Date();
    const lifecycleKey = accountLifecycleKey(user.publicId);
    const snapshotPublicId =
      action === "delete"
        ? `departed-${lifecycleKey.slice(0, 32)}`
        : user.publicId;
    const snapshot: UnavailableSnapshot = {
      publicId: snapshotPublicId,
      handle: "",
      username: UNAVAILABLE_MESSAGE_SENDER,
      avatar: "",
      reason: action === "ban" ? "banned" : "deleted",
      unavailableAt,
    };

    await db.collection<StoredMessage>("messages").updateMany(
      {
        $or: [
          { sender: userId },
          {
            "senderSnapshot.publicId": {
              $in: [user.publicId, snapshotPublicId],
            },
          },
        ],
      },
      { $set: { sender: null, senderSnapshot: snapshot } },
      { session },
    );
    await db
      .collection<StoredMessage>("messages")
      .updateMany(
        { readBy: userId },
        { $pull: { readBy: userId } } as unknown as mongo.UpdateFilter<StoredMessage>,
        { session },
      );

    const conversations = await db
      .collection<StoredConversation>("conversations")
      .find(
        {
          $or: [
            { participants: userId },
            {
              "departedParticipants.publicId": {
                $in: [user.publicId, snapshotPublicId],
              },
            },
          ],
        },
        { session },
      )
      .toArray();

    for (const conversation of conversations) {
      await db.collection<StoredConversation>("conversations").updateOne(
        { _id: conversation._id },
        {
          $pull: {
            participants: userId,
            departedParticipants: {
              publicId: { $in: [user.publicId, snapshotPublicId] },
            },
          },
          $set: {
            participantHash: `departed:${conversation._id.toHexString()}:${lifecycleKey}`,
          },
          $unset: { [`unreadCounts.${userId.toHexString()}`]: "" },
        } as unknown as mongo.UpdateFilter<StoredConversation>,
        { session },
      );
      await db.collection<StoredConversation>("conversations").updateOne(
        { _id: conversation._id },
        {
          $push: { departedParticipants: snapshot },
          ...(!conversation.isGroup
            ? { $set: { isClosed: true, closedReason: snapshot.reason } }
            : {}),
        } as unknown as mongo.UpdateFilter<StoredConversation>,
        { session },
      );
    }

    return conversations.length;
  }

  private async removeCommunityMembershipsAndTransferOwnership(
    userId: ObjectId,
    session: ClientSession,
  ): Promise<ContentCleanupResult> {
    const db = this.db();
    const cleanup: ContentCleanupResult = { posts: [], imageAssets: [] };
    const memberships = await db
      .collection<StoredCommunityMember>("communitymembers")
      .find({ userId }, { session })
      .toArray();
    const createdCommunities = await db
      .collection("communities")
      .find({ creatorId: userId }, { session, projection: { _id: 1 } })
      .toArray();
    const deletedCommunityIds: ObjectId[] = [];

    for (const community of createdCommunities) {
      const communityId = community._id as ObjectId;
      const candidates = await db
        .collection<StoredCommunityMember>("communitymembers")
        .find({ communityId, userId: { $ne: userId } }, { session })
        .toArray();
      candidates.sort((left, right) => {
        const roleDelta =
          (rolePriority[left.role ?? "member"] ?? 3) -
          (rolePriority[right.role ?? "member"] ?? 3);
        if (roleDelta !== 0) return roleDelta;
        return (left.joinedAt?.getTime() ?? 0) - (right.joinedAt?.getTime() ?? 0);
      });
      const successor = candidates[0];
      if (successor) {
        await db
          .collection("communities")
          .updateOne(
            { _id: communityId },
            { $set: { creatorId: successor.userId } },
            { session },
          );
        await db
          .collection("communitymembers")
          .updateOne(
            { _id: successor._id },
            { $set: { role: "admin" } },
            { session },
          );
      } else {
        const postIds =
          await this.contentCleanupService.findPostIdsByCommunity(communityId);
        appendCleanup(
          cleanup,
          await this.contentCleanupService.deletePostGraph(postIds),
        );
        await db
          .collection("communitymembers")
          .deleteMany({ communityId }, { session });
        await db
          .collection("communities")
          .deleteOne({ _id: communityId }, { session });
        deletedCommunityIds.push(communityId);
      }
    }

    await db
      .collection("communitymembers")
      .deleteMany({ userId }, { session });

    const affectedCommunityIds = uniqueObjectIds([
      ...memberships.map((membership) => membership.communityId),
      ...createdCommunities.map((community) => community._id as ObjectId),
    ]).filter(
      (id) => !deletedCommunityIds.some((deletedId) => deletedId.equals(id)),
    );
    for (const communityId of affectedCommunityIds) {
      const memberCount = await db
        .collection("communitymembers")
        .countDocuments({ communityId }, { session });
      await db
        .collection("communities")
        .updateOne(
          { _id: communityId },
          { $set: { "stats.memberCount": memberCount } },
          { session },
        );
    }

    if (deletedCommunityIds.length > 0) {
      await db.collection<StoredUser>("users").updateMany(
        { "joinedCommunities._id": { $in: deletedCommunityIds } },
        {
          $pull: {
            joinedCommunities: { _id: { $in: deletedCommunityIds } },
          },
        } as unknown as mongo.UpdateFilter<StoredUser>,
        { session },
      );
    }

    return cleanup;
  }

  private async findFollowerPublicIds(
    userId: ObjectId,
    session: ClientSession,
  ): Promise<string[]> {
    const db = this.db();
    const follows = await db
      .collection("follows")
      .find({ followeeId: userId }, { session, projection: { followerId: 1 } })
      .toArray();
    const followerIds = uniqueObjectIds(
      follows.map((follow) => follow.followerId as ObjectId),
    );
    if (followerIds.length === 0) return [];
    const users = await db
      .collection<StoredUser>("users")
      .find(
        { _id: { $in: followerIds } },
        { session, projection: { publicId: 1 } },
      )
      .toArray();
    return users.map((entry) => entry.publicId).filter(Boolean);
  }

  private addProfileAssets(
    assets: RemovedImageAsset[],
    user: Pick<StoredUser, "publicId" | "avatar" | "cover">,
  ): void {
    const knownAssets = new Set(
      assets.flatMap((asset) =>
        [asset.storagePublicId, asset.url].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );
    if (
      user.avatar &&
      user.avatar !== DEFAULT_ACCOUNT_AVATAR &&
      !knownAssets.has(user.avatar)
    ) {
      assets.push({ url: user.avatar, ownerPublicId: user.publicId });
      knownAssets.add(user.avatar);
    }
    if (user.cover && !knownAssets.has(user.cover)) {
      assets.push({ url: user.cover, ownerPublicId: user.publicId });
    }
  }

  private requireSession(): ClientSession {
    const session = sessionALS.getStore();
    if (!session) {
      throw Errors.internal(
        "Account cleanup must run inside a UnitOfWork transaction",
      );
    }
    return session;
  }

  private db(): Db {
    const db = this.userModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
