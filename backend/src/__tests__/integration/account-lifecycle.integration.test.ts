import "reflect-metadata";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { Types } from "mongoose";
import { randomUUID } from "node:crypto";
import {
  BANNED_ACCOUNT_COMMENT,
  DELETED_ACCOUNT_COMMENT,
  UNAVAILABLE_MESSAGE_SENDER,
  accountLifecycleKey,
} from "@/application/common/policies/account-lifecycle.policy";
import { UnitOfWork } from "@/database/UnitOfWork";
import Post from "@/models/post.model";
import User from "@/models/user.model";
import { AccountLifecycleService } from "@/services/lifecycle/account-lifecycle.service";
import { AccountAuditSnapshotService } from "@/services/lifecycle/account-audit-snapshot.service";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";

const uri = process.env.INTEGRATION_MONGODB_URI;

describe("AccountLifecycleService integration", () => {
  const departingId = new Types.ObjectId();
  const survivorId = new Types.ObjectId();
  const survivorPostId = new Types.ObjectId();
  const departingPostId = new Types.ObjectId();
  const commentId = new Types.ObjectId();
  const conversationId = new Types.ObjectId();
  const departingMessageId = new Types.ObjectId();
  const survivorMessageId = new Types.ObjectId();
  const departingPublicId = randomUUID();
  const survivorPublicId = randomUUID();
  const survivorPostPublicId = randomUUID();
  const departingPostPublicId = randomUUID();
  const conversationPublicId = randomUUID();
  let connectedHere = false;

  before(async () => {
    if (!uri) {
      throw new Error(
        "INTEGRATION_MONGODB_URI is required. Run `npm run test-integration` from the repository root to start the test replica set.",
      );
    }
    if (mongoose.connection.readyState === 0) {
      connectedHere = true;
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 5_000,
          connectTimeoutMS: 5_000,
        });
      } catch (error) {
        await mongoose.disconnect().catch(() => undefined);
        throw error;
      }
    }
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    const now = new Date();
    await db.collection("users").insertMany([
      {
        _id: departingId,
        publicId: departingPublicId,
        handle: `departing-${departingId.toHexString()}`,
        handleNormalized: `departing-${departingId.toHexString()}`,
        username: "Departing",
        email: `${departingId.toHexString()}@example.test`,
        password: "unused",
        avatar: "",
        cover: "",
        joinedCommunities: [],
        isAdmin: false,
        isBanned: false,
        postCount: 1,
        followerCount: 0,
        followingCount: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: survivorId,
        publicId: survivorPublicId,
        handle: `survivor-${survivorId.toHexString()}`,
        handleNormalized: `survivor-${survivorId.toHexString()}`,
        username: "Survivor",
        email: `${survivorId.toHexString()}@example.test`,
        password: "unused",
        avatar: "",
        cover: "",
        joinedCommunities: [],
        isAdmin: false,
        isBanned: false,
        postCount: 1,
        followerCount: 1,
        followingCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.collection("posts").insertMany([
      {
        _id: survivorPostId,
        publicId: survivorPostPublicId,
        user: survivorId,
        author: {
          _id: survivorId,
          publicId: survivorPublicId,
          handle: "survivor",
          username: "Survivor",
        },
        body: "surviving post",
        slug: `survivor-${survivorPostId.toHexString()}`,
        type: "original",
        tags: [],
        likesCount: 1,
        commentsCount: 1,
        viewsCount: 7,
        repostCount: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: departingPostId,
        publicId: departingPostPublicId,
        user: departingId,
        author: {
          _id: departingId,
          publicId: departingPublicId,
          handle: "departing",
          username: "Departing",
        },
        body: "departing post",
        slug: `departing-${departingPostId.toHexString()}`,
        type: "original",
        tags: [],
        likesCount: 0,
        commentsCount: 0,
        viewsCount: 0,
        repostCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.collection("comments").insertOne({
      _id: commentId,
      postId: survivorPostId,
      userId: departingId,
      parentId: null,
      content: "original comment",
      replyCount: 0,
      depth: 0,
      likesCount: 0,
      isEdited: false,
      isDeleted: false,
      deletedBy: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("postlikes").insertOne({
      postId: survivorPostId,
      userId: departingId,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("favorites").insertOne({
      postId: survivorPostId,
      userId: departingId,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("postviews").insertOne({
      post: survivorPostId,
      user: departingId,
      viewedAt: now,
    });
    await db.collection("follows").insertOne({
      followerId: departingId,
      followeeId: survivorId,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("useractions").insertOne({
      userId: departingId,
      actionType: "comment",
      targetId: survivorPostId,
      timestamp: now,
    });
    await db.collection("conversations").insertOne({
      _id: conversationId,
      publicId: conversationPublicId,
      participantHash: [departingId, survivorId]
        .map((id) => id.toHexString())
        .sort()
        .join(":"),
      participants: [departingId, survivorId],
      departedParticipants: [],
      lastMessage: survivorMessageId,
      lastMessageAt: now,
      unreadCounts: {
        [departingId.toHexString()]: 0,
        [survivorId.toHexString()]: 0,
      },
      isGroup: false,
      isClosed: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection("messages").insertMany([
      {
        _id: departingMessageId,
        publicId: randomUUID(),
        conversation: conversationId,
        sender: departingId,
        body: "departing user's message",
        attachments: [],
        status: "read",
        readBy: [departingId, survivorId],
        createdAt: new Date(now.getTime() - 1_000),
        updatedAt: now,
      },
      {
        _id: survivorMessageId,
        publicId: randomUUID(),
        conversation: conversationId,
        sender: survivorId,
        body: "survivor's message",
        attachments: [],
        status: "read",
        readBy: [departingId, survivorId],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterEach(async () => {
    const db = mongoose.connection.db!;
    const userIds = [departingId, survivorId];
    const postIds = [survivorPostId, departingPostId];
    await db.collection("messages").deleteMany({ conversation: conversationId });
    await db.collection("conversations").deleteMany({ _id: conversationId });
    await db.collection("commentlikes").deleteMany({ commentId });
    await db.collection("comments").deleteMany({ _id: commentId });
    await db.collection("postlikes").deleteMany({ postId: { $in: postIds } });
    await db.collection("favorites").deleteMany({ postId: { $in: postIds } });
    await db.collection("postviews").deleteMany({ post: { $in: postIds } });
    await db.collection("follows").deleteMany({
      $or: [{ followerId: { $in: userIds } }, { followeeId: { $in: userIds } }],
    });
    await db.collection("useractions").deleteMany({ userId: { $in: userIds } });
    await db.collection("posts").deleteMany({ _id: { $in: postIds } });
    await db.collection("users").deleteMany({ _id: { $in: userIds } });
  });

  after(async () => {
    if (connectedHere) await mongoose.disconnect();
  });

  it("purges owned data while preserving tombstones, messages, and view history", async () => {
    const cleanup = new ContentCleanupService(Post);
    const lifecycle = new AccountLifecycleService(User, cleanup);
    const unitOfWork = new UnitOfWork();

    const result = await unitOfWork.executeInTransaction(async () => {
      return await lifecycle.purgeUser(
        {
          _id: departingId,
          publicId: departingPublicId,
          handle: "departing",
          username: "Departing",
          avatar: "",
          cover: "",
        },
        { action: "delete", reason: "integration test" },
      );
    });

    expect(result.affectedRelationshipPublicIds).to.deep.equal([
      survivorPublicId,
    ]);
    expect(result.reconciledPostLikes).to.deep.equal([
      { postPublicId: survivorPostPublicId, likesCount: 0 },
    ]);

    const db = mongoose.connection.db!;
    expect(await db.collection("users").findOne({ _id: departingId })).to.equal(
      null,
    );
    expect(
      await db.collection("posts").findOne({ _id: departingPostId }),
    ).to.equal(null);

    const survivingPost = await db
      .collection("posts")
      .findOne({ _id: survivorPostId });
    expect(survivingPost?.likesCount).to.equal(0);
    expect(survivingPost?.commentsCount).to.equal(1);
    expect(survivingPost?.viewsCount).to.equal(7);
    expect(
      await db.collection("postviews").countDocuments({ user: departingId }),
    ).to.equal(0);

    const tombstone = await db.collection("comments").findOne({ _id: commentId });
    expect(tombstone?.content).to.equal(DELETED_ACCOUNT_COMMENT);
    expect(tombstone?.userId).to.equal(null);
    expect(tombstone?.deletionReason).to.equal("account_deleted");
    expect(tombstone?.departedUserKey).to.equal(
      accountLifecycleKey(departingPublicId),
    );

    const conversation = await db
      .collection("conversations")
      .findOne({ _id: conversationId });
    expect(conversation?.participants).to.deep.equal([survivorId]);
    expect(conversation?.isClosed).to.equal(true);
    expect(conversation?.departedParticipants?.[0]?.username).to.equal(
      UNAVAILABLE_MESSAGE_SENDER,
    );
    expect(conversation?.departedParticipants?.[0]?.publicId).to.match(
      /^departed-[a-f0-9]{32}$/,
    );
    expect(conversation?.departedParticipants?.[0]?.publicId).to.not.equal(
      departingPublicId,
    );

    const departingMessage = await db
      .collection("messages")
      .findOne({ _id: departingMessageId });
    const survivorMessage = await db
      .collection("messages")
      .findOne({ _id: survivorMessageId });
    expect(departingMessage?.sender).to.equal(null);
    expect(departingMessage?.senderSnapshot?.username).to.equal(
      UNAVAILABLE_MESSAGE_SENDER,
    );
    expect(departingMessage?.senderSnapshot?.publicId).to.equal(
      conversation?.departedParticipants?.[0]?.publicId,
    );
    expect(survivorMessage?.sender?.toString()).to.equal(
      survivorId.toHexString(),
    );
  });

  it("keeps only a banned shell and converts its tombstones on later deletion", async () => {
    const cleanup = new ContentCleanupService(Post);
    const lifecycle = new AccountLifecycleService(User, cleanup);
    const unitOfWork = new UnitOfWork();

    await unitOfWork.executeInTransaction(async () => {
      await lifecycle.purgeUser(
        {
          _id: departingId,
          publicId: departingPublicId,
          handle: "departing",
          username: "Departing",
          avatar: "",
          cover: "",
        },
        {
          action: "ban",
          reason: "integration ban reason",
          bannedBy: survivorId,
        },
      );
    });

    const db = mongoose.connection.db!;
    const bannedUser = await db
      .collection("users")
      .findOne({ _id: departingId });
    expect(bannedUser?.isBanned).to.equal(true);
    expect(bannedUser?.bannedReason).to.equal("integration ban reason");
    expect(bannedUser?.bannedBy?.toString()).to.equal(survivorId.toHexString());
    expect(bannedUser?.postCount).to.equal(0);
    expect(bannedUser?.joinedCommunities).to.deep.equal([]);

    expect(
      await db.collection("posts").findOne({ _id: departingPostId }),
    ).to.equal(null);
    const survivingPost = await db
      .collection("posts")
      .findOne({ _id: survivorPostId });
    expect(survivingPost?.likesCount).to.equal(0);
    expect(survivingPost?.viewsCount).to.equal(7);
    expect(
      await db.collection("postviews").countDocuments({ user: departingId }),
    ).to.equal(0);

    const tombstone = await db.collection("comments").findOne({ _id: commentId });
    expect(tombstone?.content).to.equal(BANNED_ACCOUNT_COMMENT);
    expect(tombstone?.userId).to.equal(null);
    expect(tombstone?.deletionReason).to.equal("account_banned");
    expect(tombstone?.departedUserKey).to.equal(
      accountLifecycleKey(departingPublicId),
    );

    const conversation = await db
      .collection("conversations")
      .findOne({ _id: conversationId });
    expect(conversation?.isClosed).to.equal(true);
    expect(conversation?.closedReason).to.equal("banned");
    expect(conversation?.departedParticipants?.[0]?.username).to.equal(
      UNAVAILABLE_MESSAGE_SENDER,
    );

    await unitOfWork.executeInTransaction(async () => {
      await lifecycle.purgeUser(
        {
          _id: departingId,
          publicId: departingPublicId,
          handle: "departing",
          username: "Departing",
          avatar: "",
          cover: "",
        },
        { action: "delete", reason: "permanent removal after ban" },
      );
    });

    expect(await db.collection("users").findOne({ _id: departingId })).to.equal(
      null,
    );
    const deletedTombstone = await db
      .collection("comments")
      .findOne({ _id: commentId });
    expect(deletedTombstone?.content).to.equal(DELETED_ACCOUNT_COMMENT);
    expect(deletedTombstone?.deletionReason).to.equal("account_deleted");
    const deletedConversation = await db
      .collection("conversations")
      .findOne({ _id: conversationId });
    expect(deletedConversation?.closedReason).to.equal("deleted");
    expect(deletedConversation?.departedParticipants?.[0]?.reason).to.equal(
      "deleted",
    );
  });

  it("captures the account and recent activity before destructive cleanup", async () => {
    const record = sinon.stub().resolves();
    const snapshot = new AccountAuditSnapshotService(User, { record } as any);

    const snapshotId = await snapshot.capture({
      action: "delete",
      actor: { type: "user", userId: departingPublicId },
      targetUserId: departingId,
      targetUserPublicId: departingPublicId,
      reason: "integration audit reason",
    });

    expect(snapshotId).to.be.a("string").and.not.equal("");
    expect(record.firstCall.args[0].eventType).to.equal(
      "account.delete.evidence.started",
    );
    expect(record.lastCall.args[0].eventType).to.equal(
      "account.delete.evidence.completed",
    );
    const chunks = record.getCalls().map((call) => call.args[0]);
    const commentChunk = chunks.find(
      (event) => event.metadata?.source === "comments",
    );
    const activityChunk = chunks.find(
      (event) => event.metadata?.source === "userActions30d",
    );
    expect(commentChunk.metadata.records[0].content).to.equal(
      "original comment",
    );
    expect(activityChunk.metadata.records[0].actionType).to.equal("comment");
    expect(commentChunk.reason).to.equal("integration audit reason");
  });
});
