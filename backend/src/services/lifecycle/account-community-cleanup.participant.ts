import { Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { requireTransactionSession } from "@/database/UnitOfWork";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import { ContentCleanupService } from "./content-cleanup.service";
import {
  AccountCommunityCleanupParticipant,
  ObjectId,
  appendCleanup,
} from "./account-lifecycle.ports";
import type { ContentCleanupResult } from "./content-cleanup.service";

type Document = mongo.Document;
const ObjectId = mongo.ObjectId;

interface StoredUser extends Document {
  _id: ObjectId;
  joinedCommunities?: Array<{ _id: ObjectId }>;
}

interface StoredCommunityMember extends Document {
  _id: ObjectId;
  communityId: ObjectId;
  userId: ObjectId;
  role?: "admin" | "moderator" | "member";
  joinedAt?: Date;
}

const rolePriority: Record<string, number> = {
  admin: 0,
  moderator: 1,
  member: 2,
};

@injectable()
export class MongoAccountCommunityCleanupParticipant
  implements AccountCommunityCleanupParticipant
{
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
    @inject(TOKENS.Services.ContentCleanup)
    private readonly contentCleanupService: ContentCleanupService,
  ) {}

  async cleanup(userId: ObjectId): Promise<ContentCleanupResult> {
    const session = requireTransactionSession();
    const db = this.db();
    const cleanup = { posts: [], imageAssets: [] };
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
        return (
          (left.joinedAt?.getTime() ?? 0) - (right.joinedAt?.getTime() ?? 0)
        );
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

    const affectedCommunityIds = this.uniqueObjectIds([
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
