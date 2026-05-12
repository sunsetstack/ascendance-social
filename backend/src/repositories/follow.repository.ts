import mongoose, { Model } from "mongoose";
import { Errors, handleMongoError } from "@/utils/errors";
import { IFollow } from "@/types";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { TOKENS } from "@/types/tokens";

@injectable()
export class FollowRepository extends BaseRepository<IFollow> {
  constructor(@inject(TOKENS.Models.Follow) model: Model<IFollow>) {
    super(model);
  }

  /**
   * Checks if a user is following another user.
   *
   * @param {string} followerId - The internal MongoDB ID of the user who follows.
   * @param {string} followeeId - The internal MongoDB ID of the user being followed.
   * @returns {Promise<boolean>} - Returns `true` if the user is following, otherwise `false`.
   */
  async isFollowing(
    followerId: string,
    followeeId: string,
  ): Promise<boolean> {
    try {
      const session = this.getSession();
      const query = this.model.findOne({ followerId, followeeId });
      if (session) query.session(session);

      const existingFollow = await query.exec();
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
    followerPublicId: string,
    followeePublicId: string,
  ): Promise<boolean> {
    try {
      const session = this.getSession();
      const [followerUser, followeeUser] = await Promise.all([
        this.model.db
          .collection("users")
          .findOne({ publicId: followerPublicId }, { projection: { _id: 1 } }),
        this.model.db
          .collection("users")
          .findOne({ publicId: followeePublicId }, { projection: { _id: 1 } }),
      ]);

      if (!followerUser || !followeeUser) return false;

      const query = this.model.findOne({
        followerId: followerUser._id,
        followeeId: followeeUser._id,
      });
      if (session) query.session(session);

      return !!(await query.exec());
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
    followerId: string,
    followeeId: string,
  ): Promise<IFollow> {
    try {
      const session = this.getSession();
      // Note: Ensure your schema has a compound unique index on {followerId, followeeId}
      // Mongoose will naturally reject duplicates and throw our typed DuplicateError
      const follow = await this.model.create([{ followerId, followeeId }], {
        session,
      });
      return follow[0];
    } catch (error) {
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
    followerPublicId: string,
    followeePublicId: string,
  ): Promise<IFollow> {
    try {
      const session = this.getSession();
      const [followerUser, followeeUser] = await Promise.all([
        this.model.db
          .collection("users")
          .findOne({ publicId: followerPublicId }, { projection: { _id: 1 } }),
        this.model.db
          .collection("users")
          .findOne({ publicId: followeePublicId }, { projection: { _id: 1 } }),
      ]);

      if (!followerUser || !followeeUser) {
        throw Errors.notFound("User");
      }

      const follow = await this.model.create(
        [
          {
            followerId: followerUser._id,
            followeeId: followeeUser._id,
          },
        ],
        { session },
      );

      return follow[0];
    } catch (error) {
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
    followerId: string,
    followeeId: string,
  ): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndDelete({ followerId, followeeId });
      if (session) query.session(session);

      const result = await query.exec();
      if (!result) {
        throw Errors.notFound("Resource");
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
    followerPublicId: string,
    followeePublicId: string,
  ): Promise<void> {
    try {
      const session = this.getSession();
      // First, get the internal IDs from public IDs
      const [followerUser, followeeUser] = await Promise.all([
        this.model.db
          .collection("users")
          .findOne({ publicId: followerPublicId }, { projection: { _id: 1 } }),
        this.model.db
          .collection("users")
          .findOne({ publicId: followeePublicId }, { projection: { _id: 1 } }),
      ]);

      if (!followerUser || !followeeUser) {
        throw Errors.notFound("User");
      }

      const followerId = followerUser._id.toString();
      const followeeId = followeeUser._id.toString();

      // Ensure that the follow relationship exists before attempting to remove it
      if (!(await this.isFollowing(followerId, followeeId))) {
        throw Errors.notFound("Resource");
      }

      // Remove the follow relationship, optionally within a transaction
      await this.model.deleteOne({ followerId, followeeId }, { session });
    } catch (error) {
      handleMongoError(error);
    }
  }

  private normalizeId(
    id: string | mongoose.Types.ObjectId,
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
    userId: string | mongoose.Types.ObjectId,
  ): Promise<string[]> {
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
        .map((id) => id.toString());
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowerObjectIdsPaginated(
    userId: string | mongoose.Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<{ ids: string[]; total: number }> {
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
        .map((id) => id.toString());

      return { ids, total };
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowingObjectIds(
    userId: string | mongoose.Types.ObjectId,
  ): Promise<string[]> {
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
        .map((id) => id.toString());
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowingObjectIdsPaginated(
    userId: string | mongoose.Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<{ ids: string[]; total: number }> {
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
        .map((id) => id.toString());

      return { ids, total };
    } catch (error) {
      handleMongoError(error);
    }
  }

  async getFollowerPublicIdsByPublicId(
    userPublicId: string,
  ): Promise<string[]> {
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
          (value): value is string =>
            typeof value === "string" && value.length > 0,
        );
    } catch (error) {
      handleMongoError(error);
    }
  }

  async deleteAllFollowsByUserId(
    userId: string,
  ): Promise<number> {
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
