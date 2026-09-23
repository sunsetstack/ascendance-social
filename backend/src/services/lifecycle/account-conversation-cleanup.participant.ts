import { Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { requireTransactionSession } from "@/database/UnitOfWork";
import {
  AccountLifecycleAction,
  UNAVAILABLE_MESSAGE_SENDER,
  accountLifecycleKey,
} from "@/application/common/policies/account-lifecycle.policy";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import {
  AccountConversationCleanupParticipant,
  AccountLifecycleUser,
  ObjectId,
} from "./account-lifecycle.ports";

type Document = mongo.Document;
const ObjectId = mongo.ObjectId;

interface UnavailableSnapshot extends Document {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  reason: "banned" | "deleted";
  unavailableAt: Date;
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

@injectable()
export class MongoAccountConversationCleanupParticipant
  implements AccountConversationCleanupParticipant
{
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
  ) {}

  async preserve(
    user: AccountLifecycleUser,
    action: AccountLifecycleAction,
  ): Promise<number> {
    const session = requireTransactionSession();
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
    await db.collection<StoredMessage>("messages").updateMany(
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

  private db(): mongo.Db {
    const db = this.userModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
