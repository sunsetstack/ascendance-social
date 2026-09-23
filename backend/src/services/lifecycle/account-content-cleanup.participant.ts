import { Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { requireTransactionSession } from "@/database/UnitOfWork";
import {
  AccountLifecycleAction,
  accountLifecycleKey,
  commentTombstoneFor,
} from "@/application/common/policies/account-lifecycle.policy";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import { ContentCleanupService } from "./content-cleanup.service";
import {
  AccountContentCleanupParticipant,
  AccountContentCleanupResult,
  AccountLifecycleUser,
  ObjectId,
  appendCleanup,
} from "./account-lifecycle.ports";

type Db = mongo.Db;
const ObjectId = mongo.ObjectId;

@injectable()
export class MongoAccountContentCleanupParticipant
  implements AccountContentCleanupParticipant
{
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.ContentCleanup)
    private readonly contentCleanupService: ContentCleanupService,
  ) {}

  async cleanup(
    user: AccountLifecycleUser,
    action: AccountLifecycleAction,
  ): Promise<AccountContentCleanupResult> {
    const userId = new ObjectId(user._id.toString());
    const cleanup: AccountContentCleanupResult = {
      posts: [],
      imageAssets: [],
      reconciledPostLikes: [],
      tombstonedCommentCount: 0,
    };
    const userPostIds = await this.contentCleanupService.findPostIdsByUser(userId);
    appendCleanup(
      cleanup,
      await this.contentCleanupService.deletePostGraph(userPostIds),
    );

    cleanup.tombstonedCommentCount = await this.tombstoneComments(
      userId,
      user.publicId,
      action,
    );
    cleanup.reconciledPostLikes = await this.removePostInteractions(userId);
    return cleanup;
  }

  private async tombstoneComments(
    userId: ObjectId,
    userPublicId: string,
    action: AccountLifecycleAction,
  ): Promise<number> {
    const session = requireTransactionSession();
    const db = this.db();
    const departedUserKey = accountLifecycleKey(userPublicId);
    const authoredComments = await db
      .collection("comments")
      .find(
        { $or: [{ userId }, { departedUserKey }] },
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
    const affectedCommentIds = this.uniqueObjectIds([
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
  ): Promise<Array<{ postPublicId: string; likesCount: number }>> {
    const session = requireTransactionSession();
    const db = this.db();
    const postLikes = await db
      .collection("postlikes")
      .find({ userId }, { session, projection: { postId: 1 } })
      .toArray();
    const affectedPostIds = this.uniqueObjectIds(
      postLikes.map((like) => like.postId as ObjectId),
    );
    await db.collection("postlikes").deleteMany({ userId }, { session });
    await this.contentCleanupService.recomputePostLikeCounts(
      affectedPostIds,
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

  private uniqueObjectIds(values: Array<ObjectId | null | undefined>): ObjectId[] {
    return Array.from(
      new Map(
        values
          .filter((value): value is ObjectId => value instanceof ObjectId)
          .map((value) => [value.toHexString(), value]),
      ).values(),
    );
  }

  private db(): Db {
    const db = this.userModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
