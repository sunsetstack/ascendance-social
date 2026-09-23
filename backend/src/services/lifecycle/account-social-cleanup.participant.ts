import { Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { requireTransactionSession } from "@/database/UnitOfWork";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import {
  AccountSocialCleanupParticipant,
  ObjectId,
} from "./account-lifecycle.ports";

type Document = mongo.Document;
const ObjectId = mongo.ObjectId;

interface StoredUser extends Document {
  _id: ObjectId;
  publicId: string;
}

@injectable()
export class MongoAccountSocialCleanupParticipant
  implements AccountSocialCleanupParticipant
{
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
  ) {}

  async captureFollowerPublicIds(userId: ObjectId): Promise<string[]> {
    const session = requireTransactionSession();
    const db = this.db();
    const follows = await db
      .collection("follows")
      .find({ followeeId: userId }, { session, projection: { followerId: 1 } })
      .toArray();
    const followerIds = this.uniqueObjectIds(
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

  async removeRelationshipsAndActivity(
    userId: ObjectId,
    userPublicId: string,
  ): Promise<string[]> {
    const session = requireTransactionSession();
    const db = this.db();
    const follows = await db
      .collection("follows")
      .find(
        { $or: [{ followerId: userId }, { followeeId: userId }] },
        { session },
      )
      .toArray();
    const affectedUserIds = this.uniqueObjectIds(
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

    let affectedRelationshipPublicIds: string[] = [];
    if (affectedUserIds.length > 0) {
      const affectedUsers = await db
        .collection<StoredUser>("users")
        .find(
          { _id: { $in: affectedUserIds } },
          { session, projection: { publicId: 1 } },
        )
        .toArray();
      affectedRelationshipPublicIds = affectedUsers
        .map((affectedUser) => affectedUser.publicId)
        .filter(Boolean);
    }

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

    return affectedRelationshipPublicIds;
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

  private db(): mongo.Db {
    const db = this.userModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
