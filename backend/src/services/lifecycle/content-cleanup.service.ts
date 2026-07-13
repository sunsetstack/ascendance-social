import { ClientSession, Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { sessionALS } from "@/database/UnitOfWork";
import { IPost } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";

type Db = mongo.Db;
type Document = mongo.Document;
type ObjectId = mongo.ObjectId;
const ObjectId = mongo.ObjectId;

interface StoredPost extends Document {
  _id: ObjectId;
  publicId: string;
  user: ObjectId;
  author?: { publicId?: string };
  type?: "original" | "repost";
  status?: string;
  repostOf?: ObjectId | null;
  tags?: ObjectId[];
  image?: ObjectId | null;
  communityId?: ObjectId | null;
}

interface StoredImage extends Document {
  _id: ObjectId;
  publicId?: string;
  url?: string;
}

export interface RemovedImageAsset {
  storagePublicId?: string;
  url?: string;
  ownerPublicId: string;
}

export interface RemovedPostSummary {
  internalId: ObjectId;
  publicId: string;
  authorPublicId: string;
}

export interface ContentCleanupResult {
  posts: RemovedPostSummary[];
  imageAssets: RemovedImageAsset[];
}

const activePostFilter = {
  $or: [
    { status: "active" },
    { status: null },
    { status: { $exists: false } },
  ],
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

@injectable()
export class ContentCleanupService {
  constructor(
    @inject(TOKENS.Models.Post) private readonly postModel: Model<IPost>,
  ) {}

  async findPostIdsByUser(userId: ObjectId): Promise<ObjectId[]> {
    const session = this.requireSession();
    const posts = await this.db()
      .collection<StoredPost>("posts")
      .find({ user: userId }, { session, projection: { _id: 1 } })
      .toArray();
    return posts.map((post) => post._id);
  }

  async findPostIdsByCommunity(communityId: ObjectId): Promise<ObjectId[]> {
    const session = this.requireSession();
    const posts = await this.db()
      .collection<StoredPost>("posts")
      .find({ communityId }, { session, projection: { _id: 1 } })
      .toArray();
    return posts.map((post) => post._id);
  }

  async deletePostGraph(rootPostIds: ObjectId[]): Promise<ContentCleanupResult> {
    const session = this.requireSession();
    const db = this.db();
    const postsCollection = db.collection<StoredPost>("posts");
    const posts = await this.collectPostGraph(rootPostIds, session);
    if (posts.length === 0) {
      return { posts: [], imageAssets: [] };
    }

    const postIds = posts.map((post) => post._id);
    const postIdSet = new Set(postIds.map((id) => id.toHexString()));
    const postPublicIds = posts.map((post) => post.publicId).filter(Boolean);
    const comments = await db
      .collection("comments")
      .find(
        { postId: { $in: postIds } },
        { session, projection: { _id: 1 } },
      )
      .toArray();
    const commentIds = comments.map((comment) => comment._id as ObjectId);
    const imageIds = uniqueObjectIds(posts.map((post) => post.image));
    const images = imageIds.length
      ? await db
          .collection<StoredImage>("images")
          .find({ _id: { $in: imageIds } }, { session })
          .toArray()
      : [];
    const imagesById = new Map(
      images.map((image) => [image._id.toHexString(), image]),
    );

    if (commentIds.length > 0) {
      await db
        .collection("commentlikes")
        .deleteMany({ commentId: { $in: commentIds } }, { session });
    }
    await db
      .collection("comments")
      .deleteMany({ postId: { $in: postIds } }, { session });
    await db
      .collection("postlikes")
      .deleteMany({ postId: { $in: postIds } }, { session });
    await db
      .collection("favorites")
      .deleteMany({ postId: { $in: postIds } }, { session });
    await db
      .collection("postviews")
      .deleteMany({ post: { $in: postIds } }, { session });

    const interactionTargetIds = [...postIds, ...commentIds];
    if (interactionTargetIds.length > 0) {
      await db
        .collection("useractions")
        .deleteMany({ targetId: { $in: interactionTargetIds } }, { session });
    }

    const notificationTargetIds = [
      ...postPublicIds,
      ...commentIds.map((id) => id.toHexString()),
    ];
    if (notificationTargetIds.length > 0) {
      await db
        .collection("notifications")
        .deleteMany({ targetId: { $in: notificationTargetIds } }, { session });
    }

    if (imageIds.length > 0) {
      await db
        .collection("images")
        .deleteMany({ _id: { $in: imageIds } }, { session });
    }
    await postsCollection.deleteMany({ _id: { $in: postIds } }, { session });

    const survivingRepostTargets = uniqueObjectIds(
      posts
        .filter(
          (post) =>
            post.type === "repost" &&
            post.repostOf &&
            !postIdSet.has(post.repostOf.toHexString()),
        )
        .map((post) => post.repostOf),
    );
    await this.recomputeRepostCounts(survivingRepostTargets, session);
    await this.recomputeUserPostCounts(
      uniqueObjectIds(posts.map((post) => post.user)),
      session,
    );
    await this.recomputeTagCounts(
      uniqueObjectIds(
        posts
          .filter((post) => post.type !== "repost")
          .flatMap((post) => post.tags ?? []),
      ),
      session,
    );
    await this.recomputeCommunityPostCounts(
      uniqueObjectIds(posts.map((post) => post.communityId)),
      session,
    );

    const imageAssets = posts.flatMap<RemovedImageAsset>((post) => {
      if (!post.image) return [];
      const image = imagesById.get(post.image.toHexString());
      if (!image) return [];
      return [
        {
          storagePublicId: image.publicId,
          url: image.url,
          ownerPublicId: post.author?.publicId ?? "",
        },
      ];
    });

    return {
      posts: posts.map((post) => ({
        internalId: post._id,
        publicId: post.publicId,
        authorPublicId: post.author?.publicId ?? "",
      })),
      imageAssets,
    };
  }

  async recomputePostLikeCounts(
    postIds: ObjectId[],
    session: ClientSession = this.requireSession(),
  ): Promise<void> {
    const ids = uniqueObjectIds(postIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("postlikes")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { postId: { $in: ids } } },
          { $group: { _id: "$postId", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(counts.map((item) => [item._id.toHexString(), item.count]));
    await db.collection("posts").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { likesCount: byId.get(id.toHexString()) ?? 0 } },
        },
      })),
      { session },
    );
  }

  async recomputeCommentLikeCounts(
    commentIds: ObjectId[],
    session: ClientSession = this.requireSession(),
  ): Promise<void> {
    const ids = uniqueObjectIds(commentIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("commentlikes")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { commentId: { $in: ids } } },
          { $group: { _id: "$commentId", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(counts.map((item) => [item._id.toHexString(), item.count]));
    await db.collection("comments").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { likesCount: byId.get(id.toHexString()) ?? 0 } },
        },
      })),
      { session },
    );
  }

  async removeCommentInteractions(commentIds: ObjectId[]): Promise<void> {
    const session = this.requireSession();
    const ids = uniqueObjectIds(commentIds);
    if (ids.length === 0) return;
    const db = this.db();
    await db
      .collection("commentlikes")
      .deleteMany({ commentId: { $in: ids } }, { session });
    await db
      .collection("useractions")
      .deleteMany({ targetId: { $in: ids } }, { session });
    await db.collection("notifications").deleteMany(
      {
        targetId: { $in: ids.map((id) => id.toHexString()) },
      },
      { session },
    );
  }

  async recomputePostCommentCounts(postIds: ObjectId[]): Promise<void> {
    const session = this.requireSession();
    const ids = uniqueObjectIds(postIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("comments")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { postId: { $in: ids } } },
          { $group: { _id: "$postId", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(
      counts.map((item) => [item._id.toHexString(), item.count]),
    );
    await db.collection("posts").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: { commentsCount: byId.get(id.toHexString()) ?? 0 },
          },
        },
      })),
      { session },
    );
  }

  async recomputeCommentReplyCounts(commentIds: ObjectId[]): Promise<void> {
    const session = this.requireSession();
    const ids = uniqueObjectIds(commentIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("comments")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { parentId: { $in: ids } } },
          { $group: { _id: "$parentId", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(
      counts.map((item) => [item._id.toHexString(), item.count]),
    );
    await db.collection("comments").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { replyCount: byId.get(id.toHexString()) ?? 0 } },
        },
      })),
      { session },
    );
  }

  private async collectPostGraph(
    rootPostIds: ObjectId[],
    session: ClientSession,
  ): Promise<StoredPost[]> {
    const roots = uniqueObjectIds(rootPostIds);
    if (roots.length === 0) return [];
    const postsCollection = this.db().collection<StoredPost>("posts");
    const collected = new Map<string, StoredPost>();
    let frontier = roots;

    while (frontier.length > 0) {
      const batch = await postsCollection
        .find(
          { $or: [{ _id: { $in: frontier } }, { repostOf: { $in: frontier } }] },
          { session },
        )
        .toArray();
      const next: ObjectId[] = [];
      for (const post of batch) {
        const key = post._id.toHexString();
        if (collected.has(key)) continue;
        collected.set(key, post);
        next.push(post._id);
      }
      frontier = next;
    }

    return [...collected.values()];
  }

  private async recomputeRepostCounts(
    postIds: ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    const ids = uniqueObjectIds(postIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("posts")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          {
            $match: {
              repostOf: { $in: ids },
              type: "repost",
              ...activePostFilter,
            },
          },
          { $group: { _id: "$repostOf", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(counts.map((item) => [item._id.toHexString(), item.count]));
    await db.collection("posts").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { repostCount: byId.get(id.toHexString()) ?? 0 } },
        },
      })),
      { session },
    );
  }

  private async recomputeUserPostCounts(
    userIds: ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    const ids = uniqueObjectIds(userIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("posts")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { user: { $in: ids }, ...activePostFilter } },
          { $group: { _id: "$user", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(counts.map((item) => [item._id.toHexString(), item.count]));
    await db.collection("users").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { postCount: byId.get(id.toHexString()) ?? 0 } },
        },
      })),
      { session },
    );
  }

  private async recomputeTagCounts(
    tagIds: ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    const ids = uniqueObjectIds(tagIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("posts")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          {
            $match: {
              tags: { $in: ids },
              type: { $ne: "repost" },
              ...activePostFilter,
            },
          },
          { $unwind: "$tags" },
          { $match: { tags: { $in: ids } } },
          { $group: { _id: "$tags", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(counts.map((item) => [item._id.toHexString(), item.count]));
    const modifiedAt = new Date();
    await db.collection("tags").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: {
              count: byId.get(id.toHexString()) ?? 0,
              modifiedAt,
            },
          },
        },
      })),
      { session },
    );
  }

  private async recomputeCommunityPostCounts(
    communityIds: ObjectId[],
    session: ClientSession,
  ): Promise<void> {
    const ids = uniqueObjectIds(communityIds);
    if (ids.length === 0) return;
    const db = this.db();
    const counts = await db
      .collection("posts")
      .aggregate<{ _id: ObjectId; count: number }>(
        [
          { $match: { communityId: { $in: ids }, ...activePostFilter } },
          { $group: { _id: "$communityId", count: { $sum: 1 } } },
        ],
        { session },
      )
      .toArray();
    const byId = new Map(counts.map((item) => [item._id.toHexString(), item.count]));
    await db.collection("communities").bulkWrite(
      ids.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: { "stats.postCount": byId.get(id.toHexString()) ?? 0 },
          },
        },
      })),
      { session },
    );
  }

  private requireSession(): ClientSession {
    const session = sessionALS.getStore();
    if (!session) {
      throw Errors.internal(
        "Content cleanup must run inside a UnitOfWork transaction",
      );
    }
    return session;
  }

  private db(): Db {
    const db = this.postModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
