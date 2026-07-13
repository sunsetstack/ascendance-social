import "reflect-metadata";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mongoose, { mongo } from "mongoose";
import { EventRegistry } from "@/application/common/events/event-registry";
import { UNAVAILABLE_MESSAGE_SENDER } from "@/application/common/policies/account-lifecycle.policy";
import { SecurityAuditEventRepository } from "@/repositories/securityAuditEvent.repository";
import { SecurityAuditService } from "@/services/security-audit.service";

type Db = mongo.Db;
type ClientSession = mongo.ClientSession;
type ObjectId = mongo.ObjectId;
type Doc = mongo.Document;

interface IntegrityReport {
  orphaned: Record<string, number>;
  duplicateRows: Record<string, number>;
  counterDrift: Record<string, number>;
  historicalViewSurplus: number;
  targetPost?: {
    publicId: string;
    stored: Record<string, number>;
    actual: Record<string, number>;
  };
}

interface Reference {
  localField: string;
  collection: string;
  foreignField?: string;
}

const SCREENSHOT_POST_PUBLIC_ID = "7c5eff02-80af-4412-be91-3ea11792b914";
const ACTIVE_POST_FILTER = {
  $or: [
    { status: { $exists: false } },
    { status: null },
    { status: "active" },
  ],
};

function objectIdKey(value: unknown): string {
  return value instanceof mongo.ObjectId ? value.toHexString() : String(value);
}

function uniqueObjectIds(values: unknown[]): ObjectId[] {
  const byId = new Map<string, ObjectId>();
  for (const value of values) {
    if (value instanceof mongo.ObjectId) byId.set(value.toHexString(), value);
  }
  return [...byId.values()];
}

async function findBrokenReferenceIds(
  db: Db,
  collection: string,
  references: Reference[],
  session?: ClientSession,
  initialMatch?: Doc,
): Promise<ObjectId[]> {
  const pipeline: Doc[] = [];
  if (initialMatch) pipeline.push({ $match: initialMatch });
  references.forEach((reference, index) => {
    pipeline.push({
      $lookup: {
        from: reference.collection,
        localField: reference.localField,
        foreignField: reference.foreignField ?? "_id",
        as: `reference${index}`,
      },
    });
  });
  pipeline.push({
    $match: {
      $or: references.map((_reference, index) => ({
        [`reference${index}`]: { $size: 0 },
      })),
    },
  });
  pipeline.push({ $project: { _id: 1 } });
  const rows = await db
    .collection(collection)
    .aggregate<{ _id: ObjectId }>(pipeline, { session })
    .toArray();
  return rows.map((row) => row._id);
}

async function findDuplicateIds(
  db: Db,
  collection: string,
  fields: string[],
  session?: ClientSession,
): Promise<ObjectId[]> {
  const groupId = Object.fromEntries(fields.map((field) => [field, `$${field}`]));
  const rows = await db
    .collection(collection)
    .aggregate<{ ids: ObjectId[] }>(
      [
        { $group: { _id: groupId, ids: { $push: "$_id" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $project: { ids: { $slice: ["$ids", 1, { $subtract: ["$count", 1] }] } } },
      ],
      { session },
    )
    .toArray();
  return rows.flatMap((row) => row.ids);
}

async function countsByObjectId(
  db: Db,
  collection: string,
  field: string,
  session?: ClientSession,
  match?: Doc,
): Promise<Map<string, number>> {
  const pipeline: Doc[] = [];
  if (match) pipeline.push({ $match: match });
  pipeline.push({ $group: { _id: `$${field}`, count: { $sum: 1 } } });
  const rows = await db
    .collection(collection)
    .aggregate<{ _id: ObjectId; count: number }>(pipeline, { session })
    .toArray();
  return new Map(rows.map((row) => [objectIdKey(row._id), row.count]));
}

async function inspectIntegrity(
  db: Db,
  session?: ClientSession,
): Promise<IntegrityReport> {
  const broken: Record<string, ObjectId[]> = {
    postsMissingUser: await findBrokenReferenceIds(
      db,
      "posts",
      [{ localField: "user", collection: "users" }],
      session,
    ),
    commentsMissingPost: await findBrokenReferenceIds(
      db,
      "comments",
      [{ localField: "postId", collection: "posts" }],
      session,
    ),
    commentsMissingParent: await findBrokenReferenceIds(
      db,
      "comments",
      [{ localField: "parentId", collection: "comments" }],
      session,
      { parentId: { $ne: null } },
    ),
    postLikes: await findBrokenReferenceIds(
      db,
      "postlikes",
      [
        { localField: "postId", collection: "posts" },
        { localField: "userId", collection: "users" },
      ],
      session,
    ),
    commentLikes: await findBrokenReferenceIds(
      db,
      "commentlikes",
      [
        { localField: "commentId", collection: "comments" },
        { localField: "userId", collection: "users" },
      ],
      session,
    ),
    favorites: await findBrokenReferenceIds(
      db,
      "favorites",
      [
        { localField: "postId", collection: "posts" },
        { localField: "userId", collection: "users" },
      ],
      session,
    ),
    postViews: await findBrokenReferenceIds(
      db,
      "postviews",
      [
        { localField: "post", collection: "posts" },
        { localField: "user", collection: "users" },
      ],
      session,
    ),
    follows: await findBrokenReferenceIds(
      db,
      "follows",
      [
        { localField: "followerId", collection: "users" },
        { localField: "followeeId", collection: "users" },
      ],
      session,
    ),
    memberships: await findBrokenReferenceIds(
      db,
      "communitymembers",
      [
        { localField: "userId", collection: "users" },
        { localField: "communityId", collection: "communities" },
      ],
      session,
    ),
    messagesMissingConversation: await findBrokenReferenceIds(
      db,
      "messages",
      [{ localField: "conversation", collection: "conversations" }],
      session,
    ),
    messagesMissingSender: await findBrokenReferenceIds(
      db,
      "messages",
      [{ localField: "sender", collection: "users" }],
      session,
      { sender: { $ne: null } },
    ),
    imagesMissingUser: await findBrokenReferenceIds(
      db,
      "images",
      [{ localField: "user", collection: "users" }],
      session,
    ),
  };

  const duplicateFields: Record<string, string[]> = {
    postLikes: ["postId", "userId"],
    commentLikes: ["commentId", "userId"],
    favorites: ["postId", "userId"],
    postViews: ["post", "user"],
    follows: ["followerId", "followeeId"],
    memberships: ["communityId", "userId"],
  };
  const duplicateRows: Record<string, number> = {};
  for (const [collection, fields] of Object.entries(duplicateFields)) {
    duplicateRows[collection] = (
      await findDuplicateIds(db, collection.toLowerCase(), fields, session)
    ).length;
  }

  const posts = await db
    .collection("posts")
    .find(
      {},
      {
        session,
        projection: {
          _id: 1,
          publicId: 1,
          likesCount: 1,
          commentsCount: 1,
          viewsCount: 1,
          repostCount: 1,
        },
      },
    )
    .toArray();
  const postLikes = await countsByObjectId(db, "postlikes", "postId", session);
  const postComments = await countsByObjectId(db, "comments", "postId", session);
  const postViews = await countsByObjectId(db, "postviews", "post", session);
  const reposts = await countsByObjectId(
    db,
    "posts",
    "repostOf",
    session,
    { type: "repost", ...ACTIVE_POST_FILTER },
  );
  const comments = await db
    .collection("comments")
    .find({}, { session, projection: { _id: 1, likesCount: 1, replyCount: 1 } })
    .toArray();
  const commentLikes = await countsByObjectId(
    db,
    "commentlikes",
    "commentId",
    session,
  );
  const replies = await countsByObjectId(db, "comments", "parentId", session, {
    parentId: { $ne: null },
  });

  const postCounterDrift = posts.filter((post) => {
    const id = objectIdKey(post._id);
    return (
      Number(post.likesCount ?? 0) !== (postLikes.get(id) ?? 0) ||
      Number(post.commentsCount ?? 0) !== (postComments.get(id) ?? 0) ||
      Number(post.repostCount ?? 0) !== (reposts.get(id) ?? 0) ||
      Number(post.viewsCount ?? 0) < (postViews.get(id) ?? 0)
    );
  }).length;
  const commentCounterDrift = comments.filter((comment) => {
    const id = objectIdKey(comment._id);
    return (
      Number(comment.likesCount ?? 0) !== (commentLikes.get(id) ?? 0) ||
      Number(comment.replyCount ?? 0) !== (replies.get(id) ?? 0)
    );
  }).length;
  const historicalViewSurplus = posts.filter((post) => {
    const id = objectIdKey(post._id);
    return Number(post.viewsCount ?? 0) > (postViews.get(id) ?? 0);
  }).length;

  const target = posts.find(
    (post) => post.publicId === SCREENSHOT_POST_PUBLIC_ID,
  );
  const targetId = target ? objectIdKey(target._id) : undefined;

  return {
    orphaned: Object.fromEntries(
      Object.entries(broken).map(([name, ids]) => [name, ids.length]),
    ),
    duplicateRows,
    counterDrift: {
      posts: postCounterDrift,
      comments: commentCounterDrift,
    },
    historicalViewSurplus,
    targetPost:
      target && targetId
        ? {
            publicId: target.publicId as string,
            stored: {
              likes: Number(target.likesCount ?? 0),
              comments: Number(target.commentsCount ?? 0),
              views: Number(target.viewsCount ?? 0),
              reposts: Number(target.repostCount ?? 0),
            },
            actual: {
              likes: postLikes.get(targetId) ?? 0,
              comments: postComments.get(targetId) ?? 0,
              views: postViews.get(targetId) ?? 0,
              reposts: reposts.get(targetId) ?? 0,
            },
          }
        : undefined,
  };
}

async function queueOutboxEvent(
  db: Db,
  eventType: string,
  payload: Doc,
  session: ClientSession,
): Promise<void> {
  await db.collection("outboxes").insertOne(
    {
      eventType,
      payload,
      traceId: randomUUID(),
      processed: false,
      processing: false,
      processedHandlers: [],
      retries: 0,
      createdAt: new Date(),
    },
    { session },
  );
}

async function removeOrphanPostGraphs(
  db: Db,
  session: ClientSession,
): Promise<void> {
  const roots = await findBrokenReferenceIds(
    db,
    "posts",
    [{ localField: "user", collection: "users" }],
    session,
  );
  if (roots.length === 0) return;

  const posts = new Map<string, Doc>();
  let frontier = roots;
  while (frontier.length > 0) {
    const batch = await db
      .collection("posts")
      .find(
        { $or: [{ _id: { $in: frontier } }, { repostOf: { $in: frontier } }] },
        { session },
      )
      .toArray();
    const next: ObjectId[] = [];
    for (const post of batch) {
      const key = objectIdKey(post._id);
      if (posts.has(key)) continue;
      posts.set(key, post);
      next.push(post._id as ObjectId);
    }
    frontier = next;
  }

  const rows = [...posts.values()];
  const postIds = rows.map((post) => post._id as ObjectId);
  const comments = await db
    .collection("comments")
    .find({ postId: { $in: postIds } }, { session, projection: { _id: 1 } })
    .toArray();
  const commentIds = comments.map((comment) => comment._id as ObjectId);
  const imageIds = uniqueObjectIds(rows.map((post) => post.image));
  const images = imageIds.length
    ? await db
        .collection("images")
        .find({ _id: { $in: imageIds } }, { session })
        .toArray()
    : [];

  for (const image of images) {
    if (typeof image.publicId === "string") {
      await queueOutboxEvent(
        db,
        EventRegistry.domain.ImageAssetCleanupRequested,
        {
          type: EventRegistry.domain.ImageAssetCleanupRequested,
          timestamp: new Date(),
          reason: "integrity-repair-orphan-post",
          storagePublicId: image.publicId,
          url: image.url,
        },
        session,
      );
    }
  }
  for (const post of rows) {
    if (typeof post.publicId === "string") {
      await queueOutboxEvent(
        db,
        EventRegistry.domain.PostDeleted,
        {
          type: EventRegistry.domain.PostDeleted,
          timestamp: new Date(),
          postId: post.publicId,
          authorPublicId: post.author?.publicId ?? "",
        },
        session,
      );
    }
  }

  if (commentIds.length > 0) {
    await db
      .collection("commentlikes")
      .deleteMany({ commentId: { $in: commentIds } }, { session });
  }
  await db.collection("comments").deleteMany({ postId: { $in: postIds } }, { session });
  await db.collection("postlikes").deleteMany({ postId: { $in: postIds } }, { session });
  await db.collection("favorites").deleteMany({ postId: { $in: postIds } }, { session });
  await db.collection("postviews").deleteMany({ post: { $in: postIds } }, { session });
  await db
    .collection("useractions")
    .deleteMany({ targetId: { $in: [...postIds, ...commentIds] } }, { session });
  await db.collection("notifications").deleteMany(
    {
      targetId: {
        $in: [
          ...rows.map((post) => post.publicId).filter(Boolean),
          ...commentIds.map((id) => id.toHexString()),
        ],
      },
    },
    { session },
  );
  if (imageIds.length > 0) {
    await db.collection("images").deleteMany({ _id: { $in: imageIds } }, { session });
  }
  await db.collection("posts").deleteMany({ _id: { $in: postIds } }, { session });
}

function unavailableSnapshot(publicId: string, reason: "unknown" = "unknown") {
  return {
    publicId,
    handle: "",
    username: UNAVAILABLE_MESSAGE_SENDER,
    avatar: "",
    reason,
    unavailableAt: new Date(),
  };
}

async function repairMessaging(db: Db, session: ClientSession): Promise<void> {
  const users = await db
    .collection("users")
    .find({}, { session, projection: { _id: 1 } })
    .toArray();
  const validUsers = new Set(users.map((user) => objectIdKey(user._id)));

  const messagesWithMissingSenders = await db
    .collection("messages")
    .aggregate<Doc>(
      [
        { $match: { sender: { $ne: null } } },
        {
          $lookup: {
            from: "users",
            localField: "sender",
            foreignField: "_id",
            as: "senderUser",
          },
        },
        { $match: { senderUser: { $size: 0 } } },
      ],
      { session },
    )
    .toArray();
  for (const message of messagesWithMissingSenders) {
    const missingSenderId = objectIdKey(message.sender);
    await db.collection("messages").updateOne(
      { _id: message._id },
      {
        $set: {
          sender: null,
          senderSnapshot:
            message.senderSnapshot ??
            unavailableSnapshot(`unavailable:${missingSenderId}`),
        },
      },
      { session },
    );
  }

  const conversations = await db
    .collection("conversations")
    .find({}, { session })
    .toArray();
  for (const conversation of conversations) {
    const participants = Array.isArray(conversation.participants)
      ? (conversation.participants as ObjectId[])
      : [];
    const missing = participants.filter(
      (participant) => !validUsers.has(objectIdKey(participant)),
    );
    if (missing.length === 0) continue;
    const remaining = participants.filter((participant) =>
      validUsers.has(objectIdKey(participant)),
    );
    const existingDeparted = Array.isArray(conversation.departedParticipants)
      ? conversation.departedParticipants
      : [];
    const departedIds = new Set(
      existingDeparted.map((participant: Doc) => participant.publicId),
    );
    const addedDeparted = missing
      .map((participant) =>
        unavailableSnapshot(`unavailable:${objectIdKey(participant)}`),
      )
      .filter((participant) => !departedIds.has(participant.publicId));
    const unreadCounts = { ...(conversation.unreadCounts ?? {}) } as Record<
      string,
      number
    >;
    for (const participant of missing) delete unreadCounts[objectIdKey(participant)];

    await db.collection("conversations").updateOne(
      { _id: conversation._id },
      {
        $set: {
          participantHash: `repaired:${objectIdKey(conversation._id)}:${Date.now()}`,
          participants: remaining,
          departedParticipants: [...existingDeparted, ...addedDeparted],
          unreadCounts,
          ...(!conversation.isGroup
            ? { isClosed: true, closedReason: "unknown" }
            : {}),
        },
      },
      { session },
    );
  }

  const orphanMessages = await db
    .collection("messages")
    .aggregate<Doc>(
      [
        {
          $lookup: {
            from: "conversations",
            localField: "conversation",
            foreignField: "_id",
            as: "conversationRow",
          },
        },
        { $match: { conversationRow: { $size: 0 } } },
        { $sort: { createdAt: 1, _id: 1 } },
      ],
      { session },
    )
    .toArray();
  const byConversation = new Map<string, Doc[]>();
  for (const message of orphanMessages) {
    const key = objectIdKey(message.conversation);
    const group = byConversation.get(key) ?? [];
    group.push(message);
    byConversation.set(key, group);
  }

  for (const [conversationId, messages] of byConversation) {
    const participantIds = uniqueObjectIds(
      messages.flatMap((message) => [
        message.sender,
        ...(Array.isArray(message.readBy) ? message.readBy : []),
      ]),
    ).filter((participant) => validUsers.has(objectIdKey(participant)));
    const lastMessage = messages[messages.length - 1];
    const needsUnavailableParticipant = participantIds.length < 2;
    await db.collection("conversations").insertOne(
      {
        _id: new mongo.ObjectId(conversationId),
        publicId: randomUUID(),
        participantHash: `recovered:${conversationId}`,
        participants: participantIds,
        departedParticipants: needsUnavailableParticipant
          ? [unavailableSnapshot(`unavailable:${conversationId}`)]
          : [],
        lastMessage: lastMessage._id,
        lastMessageAt: lastMessage.createdAt,
        unreadCounts: Object.fromEntries(
          participantIds.map((participant) => [objectIdKey(participant), 0]),
        ),
        isGroup: participantIds.length > 2,
        isClosed: needsUnavailableParticipant,
        ...(needsUnavailableParticipant ? { closedReason: "unknown" } : {}),
        createdAt: messages[0].createdAt ?? new Date(),
        updatedAt: lastMessage.createdAt ?? new Date(),
        __v: 0,
      },
      { session },
    );
  }

  const latestMessages = await db
    .collection("messages")
    .aggregate<{ _id: ObjectId; messageId: ObjectId; createdAt: Date }>(
      [
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: "$conversation",
            messageId: { $first: "$_id" },
            createdAt: { $first: "$createdAt" },
          },
        },
      ],
      { session },
    )
    .toArray();
  if (latestMessages.length > 0) {
    await db.collection("conversations").bulkWrite(
      latestMessages.map((latest) => ({
        updateOne: {
          filter: { _id: latest._id },
          update: {
            $set: {
              lastMessage: latest.messageId,
              lastMessageAt: latest.createdAt,
            },
          },
        },
      })),
      { session },
    );
  }
}

async function normalizeAndPruneNotifications(
  db: Db,
  session: ClientSession,
): Promise<void> {
  const users = await db
    .collection("users")
    .find({}, { session, projection: { _id: 1, publicId: 1 } })
    .toArray();
  for (const user of users) {
    const internalId = objectIdKey(user._id);
    if (typeof user.publicId !== "string") continue;
    await db
      .collection("notifications")
      .updateMany({ userId: internalId }, { $set: { userId: user.publicId } }, { session });
    await db
      .collection("notifications")
      .updateMany({ actorId: internalId }, { $set: { actorId: user.publicId } }, { session });
  }
  const userPublicIds = users
    .map((user) => user.publicId)
    .filter((publicId): publicId is string => typeof publicId === "string");
  await db
    .collection("notifications")
    .deleteMany({ userId: { $nin: userPublicIds } }, { session });
  await db.collection("notifications").deleteMany(
    {
      actorId: {
        $exists: true,
        $nin: [...userPublicIds, "system-monitor"],
      },
    },
    { session },
  );

  const postPublicIds = await db
    .collection("posts")
    .distinct("publicId", {}, { session });
  const commentIds = (
    await db.collection("comments").find({}, { session, projection: { _id: 1 } }).toArray()
  ).map((comment) => objectIdKey(comment._id));
  const conversationPublicIds = await db
    .collection("conversations")
    .distinct("publicId", {}, { session });
  await db
    .collection("notifications")
    .deleteMany({ targetType: "post", targetId: { $nin: postPublicIds } }, { session });
  await db
    .collection("notifications")
    .deleteMany({ targetType: "comment", targetId: { $nin: commentIds } }, { session });
  await db.collection("notifications").deleteMany(
    { targetType: "conversation", targetId: { $nin: conversationPublicIds } },
    { session },
  );
}

async function pruneUserActions(db: Db, session: ClientSession): Promise<void> {
  const userIds = (
    await db.collection("users").find({}, { session, projection: { _id: 1 } }).toArray()
  ).map((user) => user._id);
  const postIds = (
    await db.collection("posts").find({}, { session, projection: { _id: 1 } }).toArray()
  ).map((post) => post._id);
  const commentIds = (
    await db.collection("comments").find({}, { session, projection: { _id: 1 } }).toArray()
  ).map((comment) => comment._id);
  await db
    .collection("useractions")
    .deleteMany({ userId: { $nin: userIds } }, { session });
  await db.collection("useractions").deleteMany(
    {
      actionType: { $in: ["like", "unlike", "comment", "comment_deleted"] },
      targetId: { $nin: postIds },
    },
    { session },
  );
  await db.collection("useractions").deleteMany(
    {
      actionType: { $in: ["comment_like", "comment_unlike"] },
      targetId: { $nin: commentIds },
    },
    { session },
  );
  await db.collection("useractions").deleteMany(
    {
      actionType: { $in: ["follow", "unfollow", "profile_update"] },
      targetId: { $nin: userIds },
    },
    { session },
  );
}

async function reconcileCounters(db: Db, session: ClientSession): Promise<void> {
  const postLikes = await countsByObjectId(db, "postlikes", "postId", session);
  const postComments = await countsByObjectId(db, "comments", "postId", session);
  const postViews = await countsByObjectId(db, "postviews", "post", session);
  const reposts = await countsByObjectId(
    db,
    "posts",
    "repostOf",
    session,
    { type: "repost", ...ACTIVE_POST_FILTER },
  );
  const posts = await db
    .collection("posts")
    .find({}, { session, projection: { _id: 1, viewsCount: 1 } })
    .toArray();
  if (posts.length > 0) {
    await db.collection("posts").bulkWrite(
      posts.map((post) => {
        const id = objectIdKey(post._id);
        return {
          updateOne: {
            filter: { _id: post._id },
            update: {
              $set: {
                likesCount: postLikes.get(id) ?? 0,
                commentsCount: postComments.get(id) ?? 0,
                repostCount: reposts.get(id) ?? 0,
                viewsCount: Math.max(
                  Number(post.viewsCount ?? 0),
                  postViews.get(id) ?? 0,
                ),
              },
            },
          },
        };
      }),
      { session },
    );
  }

  const commentLikes = await countsByObjectId(
    db,
    "commentlikes",
    "commentId",
    session,
  );
  const replies = await countsByObjectId(db, "comments", "parentId", session, {
    parentId: { $ne: null },
  });
  const comments = await db
    .collection("comments")
    .find({}, { session, projection: { _id: 1 } })
    .toArray();
  if (comments.length > 0) {
    await db.collection("comments").bulkWrite(
      comments.map((comment) => {
        const id = objectIdKey(comment._id);
        return {
          updateOne: {
            filter: { _id: comment._id },
            update: {
              $set: {
                likesCount: commentLikes.get(id) ?? 0,
                replyCount: replies.get(id) ?? 0,
              },
            },
          },
        };
      }),
      { session },
    );
  }

  const userPosts = await countsByObjectId(
    db,
    "posts",
    "user",
    session,
    ACTIVE_POST_FILTER,
  );
  const followers = await countsByObjectId(db, "follows", "followeeId", session);
  const following = await countsByObjectId(db, "follows", "followerId", session);
  const users = await db
    .collection("users")
    .find({}, { session, projection: { _id: 1 } })
    .toArray();
  if (users.length > 0) {
    await db.collection("users").bulkWrite(
      users.map((user) => {
        const id = objectIdKey(user._id);
        return {
          updateOne: {
            filter: { _id: user._id },
            update: {
              $set: {
                postCount: userPosts.get(id) ?? 0,
                followerCount: followers.get(id) ?? 0,
                followingCount: following.get(id) ?? 0,
              },
            },
          },
        };
      }),
      { session },
    );
  }

  const tagCounts = await db
    .collection("posts")
    .aggregate<{ _id: ObjectId; count: number }>(
      [
        { $match: { type: { $ne: "repost" }, ...ACTIVE_POST_FILTER } },
        { $unwind: "$tags" },
        { $group: { _id: "$tags", count: { $sum: 1 } } },
      ],
      { session },
    )
    .toArray();
  const tagCountById = new Map(
    tagCounts.map((tag) => [objectIdKey(tag._id), tag.count]),
  );
  const tags = await db.collection("tags").find({}, { session, projection: { _id: 1 } }).toArray();
  if (tags.length > 0) {
    await db.collection("tags").bulkWrite(
      tags.map((tag) => ({
        updateOne: {
          filter: { _id: tag._id },
          update: {
            $set: {
              count: tagCountById.get(objectIdKey(tag._id)) ?? 0,
              modifiedAt: new Date(),
            },
          },
        },
      })),
      { session },
    );
  }

  const memberCounts = await countsByObjectId(
    db,
    "communitymembers",
    "communityId",
    session,
  );
  const communityPosts = await countsByObjectId(
    db,
    "posts",
    "communityId",
    session,
    { communityId: { $ne: null }, ...ACTIVE_POST_FILTER },
  );
  const communities = await db
    .collection("communities")
    .find({}, { session })
    .toArray();
  if (communities.length > 0) {
    await db.collection("communities").bulkWrite(
      communities.map((community) => {
        const id = objectIdKey(community._id);
        return {
          updateOne: {
            filter: { _id: community._id },
            update: {
              $set: {
                "stats.memberCount": memberCounts.get(id) ?? 0,
                "stats.postCount": communityPosts.get(id) ?? 0,
              },
            },
          },
        };
      }),
      { session },
    );
  }

  const communityById = new Map(
    communities.map((community) => [objectIdKey(community._id), community]),
  );
  const memberships = await db
    .collection("communitymembers")
    .find({}, { session })
    .sort({ joinedAt: -1, _id: -1 })
    .toArray();
  for (const user of users) {
    const joinedCommunities = memberships
      .filter((membership) => objectIdKey(membership.userId) === objectIdKey(user._id))
      .slice(0, 10)
      .flatMap((membership) => {
        const community = communityById.get(objectIdKey(membership.communityId));
        if (!community) return [];
        return [
          {
            _id: community._id,
            name: community.name,
            slug: community.slug,
            icon: community.avatar ?? "",
          },
        ];
      });
    await db
      .collection("users")
      .updateOne({ _id: user._id }, { $set: { joinedCommunities } }, { session });
  }
}

async function applyRepairs(db: Db, session: ClientSession): Promise<void> {
  await removeOrphanPostGraphs(db, session);
  await repairMessaging(db, session);

  const commentsMissingPost = await findBrokenReferenceIds(
    db,
    "comments",
    [{ localField: "postId", collection: "posts" }],
    session,
  );
  if (commentsMissingPost.length > 0) {
    await db
      .collection("commentlikes")
      .deleteMany({ commentId: { $in: commentsMissingPost } }, { session });
    await db
      .collection("useractions")
      .deleteMany({ targetId: { $in: commentsMissingPost } }, { session });
    await db.collection("notifications").deleteMany(
      { targetId: { $in: commentsMissingPost.map((id) => id.toHexString()) } },
      { session },
    );
    await db
      .collection("comments")
      .deleteMany({ _id: { $in: commentsMissingPost } }, { session });
  }

  const commentsMissingParent = await findBrokenReferenceIds(
    db,
    "comments",
    [{ localField: "parentId", collection: "comments" }],
    session,
    { parentId: { $ne: null } },
  );
  if (commentsMissingParent.length > 0) {
    await db.collection("comments").updateMany(
      { _id: { $in: commentsMissingParent } },
      { $set: { parentId: null, depth: 0 } },
      { session },
    );
  }

  const relationSpecs: Array<{
    collection: string;
    references: Reference[];
    duplicateFields: string[];
  }> = [
    {
      collection: "postlikes",
      references: [
        { localField: "postId", collection: "posts" },
        { localField: "userId", collection: "users" },
      ],
      duplicateFields: ["postId", "userId"],
    },
    {
      collection: "commentlikes",
      references: [
        { localField: "commentId", collection: "comments" },
        { localField: "userId", collection: "users" },
      ],
      duplicateFields: ["commentId", "userId"],
    },
    {
      collection: "favorites",
      references: [
        { localField: "postId", collection: "posts" },
        { localField: "userId", collection: "users" },
      ],
      duplicateFields: ["postId", "userId"],
    },
    {
      collection: "postviews",
      references: [
        { localField: "post", collection: "posts" },
        { localField: "user", collection: "users" },
      ],
      duplicateFields: ["post", "user"],
    },
    {
      collection: "follows",
      references: [
        { localField: "followerId", collection: "users" },
        { localField: "followeeId", collection: "users" },
      ],
      duplicateFields: ["followerId", "followeeId"],
    },
    {
      collection: "communitymembers",
      references: [
        { localField: "userId", collection: "users" },
        { localField: "communityId", collection: "communities" },
      ],
      duplicateFields: ["communityId", "userId"],
    },
  ];
  for (const spec of relationSpecs) {
    const brokenIds = await findBrokenReferenceIds(
      db,
      spec.collection,
      spec.references,
      session,
    );
    const duplicateIds = await findDuplicateIds(
      db,
      spec.collection,
      spec.duplicateFields,
      session,
    );
    const removeIds = uniqueObjectIds([...brokenIds, ...duplicateIds]);
    if (removeIds.length > 0) {
      await db
        .collection(spec.collection)
        .deleteMany({ _id: { $in: removeIds } }, { session });
    }
  }

  const orphanImages = await findBrokenReferenceIds(
    db,
    "images",
    [{ localField: "user", collection: "users" }],
    session,
  );
  if (orphanImages.length > 0) {
    const images = await db
      .collection("images")
      .find({ _id: { $in: orphanImages } }, { session })
      .toArray();
    for (const image of images) {
      if (typeof image.publicId === "string") {
        await queueOutboxEvent(
          db,
          EventRegistry.domain.ImageAssetCleanupRequested,
          {
            type: EventRegistry.domain.ImageAssetCleanupRequested,
            timestamp: new Date(),
            reason: "integrity-repair-orphan-image",
            storagePublicId: image.publicId,
            url: image.url,
          },
          session,
        );
      }
    }
    await db
      .collection("images")
      .deleteMany({ _id: { $in: orphanImages } }, { session });
  }

  await normalizeAndPruneNotifications(db, session);
  await pruneUserActions(db, session);
  await reconcileCounters(db, session);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      "MONGODB_URI is required. The repair never loads .env implicitly; pass the intended database explicitly.",
    );
  }
  process.env.AUDIT_LOG_DIR ??= path.resolve(process.cwd(), "audit", "logs");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB connection is not initialized");

  const before = await inspectIntegrity(db);
  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", before }, null, 2));
    return;
  }

  const audit = new SecurityAuditService(new SecurityAuditEventRepository());
  const auditInput = {
    actor: { type: "system" as const, userId: "integrity-repair-script" },
    target: { type: "database", id: db.databaseName },
    outcome: "success" as const,
    reason: "repair_legacy_relationship_and_counter_drift",
  };
  await audit.record({
    ...auditInput,
    eventType: "data.integrity.repair.started",
    metadata: { before },
  });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => applyRepairs(db, session),
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      },
    );
    const after = await inspectIntegrity(db);
    await audit.record({
      ...auditInput,
      eventType: "data.integrity.repair.completed",
      metadata: { before, after },
    });
    console.log(JSON.stringify({ mode: "apply", before, after }, null, 2));
  } catch (error) {
    await audit.record({
      actor: auditInput.actor,
      target: auditInput.target,
      eventType: "data.integrity.repair.failed",
      outcome: "failure",
      reason: error instanceof Error ? error.message : String(error),
      metadata: { before },
    });
    throw error;
  } finally {
    await session.endSession();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
