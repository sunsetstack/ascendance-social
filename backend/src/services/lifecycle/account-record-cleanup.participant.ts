import { Model, mongo } from "mongoose";
import { inject, injectable } from "tsyringe";
import { requireTransactionSession } from "@/database/UnitOfWork";
import { DEFAULT_ACCOUNT_AVATAR } from "@/application/common/policies/account-lifecycle.policy";
import { IUser } from "@/types";
import { TOKENS } from "@/types/tokens";
import { Errors } from "@/utils/errors";
import {
  AccountLifecycleUser,
  AccountRecordCleanupOptions,
  AccountRecordCleanupParticipant,
} from "./account-lifecycle.ports";
import type { RemovedImageAsset } from "./content-cleanup.service";

@injectable()
export class MongoAccountRecordCleanupParticipant
  implements AccountRecordCleanupParticipant
{
  constructor(
    @inject(TOKENS.Models.User) private readonly userModel: Model<IUser>,
  ) {}

  async finalize(
    user: AccountLifecycleUser,
    options: AccountRecordCleanupOptions,
  ): Promise<RemovedImageAsset[]> {
    const session = requireTransactionSession();
    const db = this.db();
    const userId = new mongo.ObjectId(user._id.toString());
    const imageAssets: RemovedImageAsset[] = [];
    const remainingImages = await db
      .collection("images")
      .find({ user: userId }, { session })
      .toArray();
    if (remainingImages.length > 0) {
      await db
        .collection("images")
        .deleteMany({ user: userId }, { session });
      imageAssets.push(
        ...remainingImages.map((image) => ({
          storagePublicId:
            typeof image.publicId === "string" ? image.publicId : undefined,
          url: typeof image.url === "string" ? image.url : undefined,
          ownerPublicId: user.publicId,
        })),
      );
    }

    this.addProfileAssets(imageAssets, user);

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

    return imageAssets;
  }

  private addProfileAssets(
    assets: RemovedImageAsset[],
    user: Pick<AccountLifecycleUser, "publicId" | "avatar" | "cover">,
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

  private db(): mongo.Db {
    const db = this.userModel.db.db;
    if (!db) {
      throw Errors.database("MongoDB connection is not initialized");
    }
    return db;
  }
}
