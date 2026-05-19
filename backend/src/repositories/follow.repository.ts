import mongoose, { ClientSession, Model } from "mongoose";
import {
  Errors,
  createError,
  handleMongoError,
  isMongoDBDuplicateKeyError,
} from "@/utils/errors";
import { IFollow } from "@/types";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId, asMongoId } from "@/types/branded";

@injectable()
export class FollowRepository extends BaseRepository<IFollow> {
  constructor(@inject(TOKENS.Models.Follow) model: Model<IFollow>) {
    super(model);
  }

  private getActiveSession(session?: ClientSession): ClientSession | undefined {
    return session ?? this.getSession();
  }

  private applySession<T>(query: T, session?: ClientSession): T {
    if (
      session &&
      typeof query === "object" &&
      query !== null &&
      "session" in query &&
      typeof (query as { session?: (session: ClientSession) => unknown }).session ===
        "function"
    ) {
      (query as { session: (session: ClientSession) => unknown }).session(
        session,
      );
    }

    return query;
  }

  private async resolveOperation<TResult>(operation: unknown): Promise<TResult> {
    if (
      typeof operation === "object" &&
      operation !== null &&
      "exec" in operation &&
      typeof (operation as { exec?: () => Promise<TResult> }).exec === "function"
    ) {
      return await (operation as { exec: () => Promise<TResult> }).exec();
    }

    return await Promise.resolve(operation as TResult);
  }

  /**
   * Checks if a user is following another user.
   *
   * @param {string} followerId - The internal MongoDB ID of the user who follows.
   * @param {string} followeeId - The internal MongoDB ID of the user being followed.
   * @returns {Promise<boolean>} - Returns `true` if the user is following, otherwise `false`.
   */
  async isFollowing(
    followerId: MongoId,
    followeeId: MongoId,
    session?: ClientSession,
  ): Promise<boolean> {
    try {
      const activeSession = this.getActiveSession(session);
      const query = this.applySession(
        this.model.findOne({ followerId, followeeId }),
        activeSession,
      );

      const existingFollow = await this.resolveOperation<IFollow | null>(query);
      return !!existingFollow;
    } catch (error) {
      handleMongoError(error);
    }
  }
  /**
   * Checks if a user is following another user using public IDs.
   *
   * @param {string} followerPublicId - The public ID of the user who follows.
   * @param {string} followeePublicId - The public ID of the user being followed.
   * @returns {Promise<boolean>} - Returns `true` if the user is following, otherwise `false`.
   */
  async isFollowingByPublicId(
    followerPublicId: UserPublicId,
    followeePublicId: UserPublicId,
    session?: ClientSession,
  ): Promise<boolean> {
    try {
      const activeSession = this.getActiveSession(session);
      const [followerUser, followeeUser] = await Promise.all([
        this.model.db
          .collection("users")
          .findOne({ publicId: followerPublicId }, { projection: { _id: 1 } }),
        this.model.db
          .collection("users")
          .findOne({ publicId: followeePublicId }, { projection: { _id: 1 } }),
      ]);

      if (!followerUser || !followeeUser) return false;

      const query = this.applySession(
        this.model.findOne({
          followerId: followerUser._id,
          followeeId: followeeUser._id,
        }),
        activeSession,
      );

      return !!(await this.resolveOperation<IFollow | null>(query));
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Creates a follow relationship between two users.
   *
   * @param {string} followerId - The internal MongoDB ID of the user who is following.
   * @param {string} followeeId - The internal MongoDB ID of the user being followed.
   * @returns {Promise<IFollow>} - The newly created follow record.
   * @throws {Error} - Throws a "DuplicateError" if the follow relationship already exists.
   */
  async addFollow(
    followerId: MongoId,
    followeeId: MongoId,
    session?: ClientSession,
  ): Promise<IFollow> {
    try {
      const activeSession = this.getActiveSession(session);
      const existingFollow = await this.isFollowing(
        followerId,
        followeeId,
        activeSession,
      );

      if (existingFollow) {
        throw Errors.duplicate("Already following this user");
      }

      const follow = await this.model.create([{ followerId, followeeId }], {
        session: activeSession,
      });
      return follow[0];
    } catch (error) {
      if (isMongoDBDuplicateKeyError(error)) {
        throw Errors.duplicate("Already following this user", { cause: error });
      }
      handleMongoError(error);
    }
  }
  /**
   * Creates a follow relationship between two users using public IDs.
   *
   * @param {string} followerPublicId - The public ID of the user who is following.
   * @param {string} followeePublicId - The public ID of the user being followed.
   * @returns {Promise<IFollow>} - The newly created follow record.
   * @throws {Error} - Throws a "DuplicateError" if the follow relationship already exists.
   */
  async addFollowByPublicId(
    followerPublicId: UserPublicId,
    followeePublicId: UserPublicId,
    session?: ClientSession,
  ): Promise<IFollow> {
    try {
      const activeSession = this.getActiveSession(session);
      const [followerUser, followeeUser] = await Promise.all([
        this.model.db
          .collection("users")
          .findOne({ publicId: followerPublicId }, { projection: { _id: 1 } }),
        this.model.db
          .collection("users")
          .findOne({ publicId: followeePublicId }, { projection: { _id: 1 } }),
      ]);

      if (!followerUser || !followeeUser) {
        throw createError("NotFoundError", "One or both users not found");
      }

      const followerId = asMongoId(followerUser._id.toString());
      const followeeId = asMongoId(followeeUser._id.toString());
      const existingFollow = await this.isFollowing(
        followerId,
        followeeId,
        activeSession,
      );

      if (existingFollow) {
        throw Errors.duplicate("Already following this user");
      }

      const follow = await this.model.create(
        [
          {
            followerId,
            followeeId,
          },
        ],
        { session: activeSession },
      );

      return follow[0];
    } catch (error) {
      if (isMongoDBDuplicateKeyError(error)) {
        throw Errors.duplicate("Already following this user", { cause: error });
      }
      handleMongoError(error);
    }
  }
  /**
   * Removes a follow relationship between two users.
   *
   * @param {string} followerId - The internal MongoDB ID of the user who is following.
   * @param {string} followeeId - The internal MongoDB ID of the user being followed.
   * @returns {Promise<void>} - Resolves when the follow relationship is removed.
   * @throws {Error} - Throws a "NotFoundError" if the follow relationship does not exist.
   */
  async removeFollow(
    followerId: MongoId,
    followeeId: MongoId,
    session?: ClientSession,
  ): Promise<void> {
    try {
      const activeSession = this.getActiveSession(session);
      const existingFollow = await this.isFollowing(
        followerId,
        followeeId,
        activeSession,
      );

      if (!existingFollow) {
        throw createError("NotFoundError", "Not following this user");
      }

      const result = await this.resolveOperation<{ deletedCount?: number }>(
        this.model.deleteOne(
          { followerId, followeeId },
          { session: activeSession },
        ),
      );
      if ((result?.deletedCount ?? 0) === 0) {
        throw createError("NotFoundError", "Not following this user");
      }
    } catch (error) {
      handleMongoError(error);
    }
  }

  /**
   * Removes a follow relationship between two users using public IDs.
   *
   * @param {string} followerPublicId - The public ID of the user who is following.
   * @param {string} followeePublicId - The public ID of the user being followed.
   * @returns {Promise<void>} - Resolves when the follow relationship is removed.
   * @throws {Error} - Throws a "NotFoundError" if the follow relationship does not exist.
   */
  async removeFollowByPublicId(
    followerPublicId: UserPublicId,
    followeePublicId: UserPublicId,
    session?: ClientSession,
  ): Promise<void> {
    try {
      const [followerUser, followeeUser] = await Promise.all([
        this.model.db
          .collection("users")
          .findOne({ publicId: followerPublicId }, { projection: { _id: 1 } }),
        this.model.db
          .collection("users")
          .findOne({ publicId: followeePublicId }, { projection: { _id: 1 } }),
      ]);

      if (!followerUser || !followeeUser) {
        throw createError("NotFoundError", "One or both users not found");
      }

      const activeSession = this.getActiveSession(session);
      const followerId = asMongoId(followerUser._id.toString());
      const followeeId = asMongoId(followeeUser._id.toString());
      const existingFollow = await this.isFollowing(
        followerId,
        followeeId,
        activeSession,
      );

      if (!existingFollow) {
        throw createError("NotFoundError", "Not following this user");
      }

      const result = await this.resolveOperation<{ deletedCount?: number }>(
        this.model.deleteOne(
          { followerId, followeeId },
          { session: activeSession },
        ),
      );
      if ((result?.deletedCount ?? 0) === 0) {
        throw createError("NotFoundError", "Not following this user");
      }
    } catch (error) {
      handleMongoError(error);
    }
  }

  private normalizeId(
    id: string | MongoId | mongoose.Types.ObjectId,
  ): mongoose.Types.ObjectId {
    if (id instanceof mongoose.Types.ObjectId) {
      return id;
    }
    return new mongoose.Types.ObjectId(id);
  }

  async countFollowersByUserId(
    userId: string | mongoose.Types.ObjectId,
  ): Promise<number> {
    try {
      const session = this.getSession();
      const normalized = this.normalizeId(userId);
      const query = this.model.countDocuments({ followeeId: normalized });
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async countFollowingByUserId(
    userId: string | mongoose.Types.ObjectId,
  ): Promise<number> {
    try {
      const session = this.getSession();
      const normalized = this.normalizeId(userId);
      const query = this.model.countDocuments({ followerId: normalized });
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowerObjectIds(
    userId: MongoId | mongoose.Types.ObjectId,
  ): Promise<MongoId[]> {
    try {
      const normalized = this.normalizeId(userId);
      const followers = await this.model
        .find({ followeeId: normalized })
        .select("followerId")
        .lean<{ followerId?: mongoose.Types.ObjectId }[]>()
        .exec();
      return followers
        .map((doc) => doc?.followerId)
        .filter((id): id is mongoose.Types.ObjectId => id != null)
        .map((id) => asMongoId(id.toString()));
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowerObjectIdsPaginated(
    userId: MongoId | mongoose.Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<{ ids: MongoId[]; total: number }> {
    try {
      const normalized = this.normalizeId(userId);
      const safePage = Math.max(1, Math.floor(page || 1));
      const safeLimit = Math.max(1, Math.floor(limit || 20));
      const skip = (safePage - 1) * safeLimit;

      const [followers, total] = await Promise.all([
        this.model
          .find({ followeeId: normalized })
          .select("followerId")
          .skip(skip)
          .limit(safeLimit)
          .lean<{ followerId?: mongoose.Types.ObjectId }[]>()
          .exec(),
        this.model.countDocuments({ followeeId: normalized }).exec(),
      ]);

      const ids = followers
        .map((doc) => doc?.followerId)
        .filter((id): id is mongoose.Types.ObjectId => id != null)
        .map((id) => asMongoId(id.toString()));

      return { ids, total };
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowingObjectIds(
    userId: MongoId | mongoose.Types.ObjectId,
  ): Promise<MongoId[]> {
    try {
      const normalized = this.normalizeId(userId);
      const following = await this.model
        .find({ followerId: normalized })
        .select("followeeId")
        .lean<{ followeeId?: mongoose.Types.ObjectId }[]>()
        .exec();
      return following
        .map((doc) => doc?.followeeId)
        .filter((id): id is mongoose.Types.ObjectId => id != null)
        .map((id) => asMongoId(id.toString()));
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowingObjectIdsPaginated(
    userId: MongoId | mongoose.Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<{ ids: MongoId[]; total: number }> {
    try {
      const normalized = this.normalizeId(userId);
      const safePage = Math.max(1, Math.floor(page || 1));
      const safeLimit = Math.max(1, Math.floor(limit || 20));
      const skip = (safePage - 1) * safeLimit;

      const [following, total] = await Promise.all([
        this.model
          .find({ followerId: normalized })
          .select("followeeId")
          .skip(skip)
          .limit(safeLimit)
          .lean<{ followeeId?: mongoose.Types.ObjectId }[]>()
          .exec(),
        this.model.countDocuments({ followerId: normalized }).exec(),
      ]);

      const ids = following
        .map((doc) => doc?.followeeId)
        .filter((id): id is mongoose.Types.ObjectId => id != null)
        .map((id) => asMongoId(id.toString()));

      return { ids, total };
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowerPublicIdsByPublicId(
    userPublicId: UserPublicId,
  ): Promise<UserPublicId[]> {
    try {
      const user = await this.model.db
        .collection("users")
        .findOne({ publicId: userPublicId }, { projection: { _id: 1 } });
      if (!user?._id) return [];

      const followers = await this.model
        .aggregate<{ publicId?: string }>([
          { $match: { followeeId: user._id } },
          {
            $lookup: {
              from: "users",
              localField: "followerId",
              foreignField: "_id",
              as: "follower",
            },
          },
          { $unwind: "$follower" },
          { $project: { publicId: "$follower.publicId" } },
        ])
        .exec();

      return followers
        .map((doc) => doc?.publicId)
        .filter(
          (value): value is UserPublicId =>
            typeof value === "string" && value.length > 0,
        );
    } catch (error) {
      handleMongoError(error);
    }
  }

  async deleteAllFollowsByUserId(userId: MongoId): Promise<number> {
    try {
      const session = this.getSession();
      const userObjectId = this.normalizeId(userId);
      const result = await this.model
        .deleteMany({
          $or: [{ followerId: userObjectId }, { followeeId: userObjectId }],
        })
        .session(session || null)
        .exec();
      return result.deletedCount || 0;
    } catch (error) {
      handleMongoError(error);
    }
  }
}
