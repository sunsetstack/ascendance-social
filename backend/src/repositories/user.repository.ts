import { Model, Types, UpdateQuery } from "mongoose";
import {
  IUser,
  PaginationOptions,
  PaginationResult,
  UserSuggestion,
} from "@/types";
import { Errors, isMongoDBDuplicateKeyError } from "@/utils/errors";
import { injectable, inject } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { FollowRepository } from "./follow.repository";
import { logger } from "@/utils/winston";
import { escapeRegex } from "@/utils/sanitizers";
import { TOKENS } from "@/types/tokens";

/**
 * UserRepository provides database access for user-related operations.
 * It extends BaseRepository and includes custom methods for user management.
 */
@injectable()
export class UserRepository extends BaseRepository<IUser> {
  constructor(
    @inject(TOKENS.Models.User) model: Model<IUser>,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
  ) {
    super(model);
  }

  // TODO: REFACTOR AND REMOVE OLD METHODS

  /**
   * Creates a new user in the database, handling duplicate key errors.
   * @param userData - Partial user data to create a new user.
   * @param session - (Optional) Mongoose session for transactions.
   * @returns The created user object.
   */
  async create(userData: Partial<IUser>): Promise<IUser> {
    try {
      const session = this.getSession();
      const doc = new this.model(userData);
      if (session) doc.$session(session);
      return await doc.save();
    } catch (error) {
      if (isMongoDBDuplicateKeyError(error)) {
        const field = Object.keys(error.keyValue)[0];
        throw Errors.validation(`${field} already exists`, {
          context: { operation: "create", repository: "userRepository" },
        });
      }
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Updates a user's data based on a given user ID.
   * Supports flexible updates with MongoDB operators (e.g., `$set`, `$addToSet`).
   * @param id - User ID to update.
   * @param updateData - Update operations.
   * @param session - (Optional) Mongoose session for transactions.
   * @returns The updated user object or null if not found.
   */
  async update(
    id: string,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    try {
      const session = this.getSession();
      logger.info("updateData in user repo:", updateData);

      const query = this.model.findOneAndUpdate({ _id: id }, updateData, {
        new: true,
      });

      if (session) query.session(session);
      const result = await query.exec();
      return result;
    } catch (error) {
      if (isMongoDBDuplicateKeyError(error)) {
        const field = Object.keys(error.keyValue)[0];
        throw Errors.validation(`${field} already exists`, {
          context: { operation: "create", repository: "userRepository" },
        });
      }
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async updateByPublicId(
    publicId: string,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndUpdate({ publicId }, updateData, {
        new: true,
      });
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      if (isMongoDBDuplicateKeyError(error)) {
        const field = Object.keys(error.keyValue)[0];
        throw Errors.validation(`${field} already exists`, {
          context: {
            operation: "updateByPublicId",
            repository: "userRepository",
          },
        });
      }
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Retrieves a paginated list of users with optional search functionality.
   * @param {Object} options - The filtering and pagination options.
   * @param {string[]} [options.search] - An array of search terms for filtering users by username.
   * @param {number} [options.page=1] - The page number for pagination (default: 1).
   * @param {number} [options.limit=20] - The maximum number of users per page (default: 20).
   * @returns {Promise<IUser[] | null>} - A promise that resolves to an array of users or null if no users match.
   * @throws {Error} - Throws a 'DatabaseError' if the query fails.
   */
  async getAll(options: {
    search?: string[];
    page?: number;
    limit?: number;
  }): Promise<IUser[] | null> {
    try {
      const query: Record<string, unknown> = {};

      if (options.search && options.search.length > 0) {
        const patterns = options.search.map((term: string) => ({
          $regex: escapeRegex(term),
          $options: "i",
        }));
        query.$or = patterns.flatMap((pattern) => [
          { username: pattern },
          { handle: pattern },
        ]);
      }

      const page = options?.page || 1;
      const limit = options?.limit || 20;
      const skip = (page - 1) * limit;

      const result = await this.model
        .find(query)
        .skip(skip)
        .limit(limit)
        .exec();
      if (!result || result.length === 0) {
        return null;
      }

      return result;
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error), {
        context: { operation: "getAll", options },
      });
    }
  }

  // Find user by public id
  async findByPublicId(publicId: string): Promise<IUser | null> {
    const session = this.getSession();
    if (session) {
      return this.model.findOne({ publicId }).session(session).exec();
    }
    return this.model.findOne({ publicId }).exec();
  }

  //find by query
  find(query: Record<string, unknown>) {
    return this.model.find(query);
  }

  // Lightweight internal id lookup by publicId (projection only _id)
  async findInternalIdByPublicId(publicId: string): Promise<string | null> {
    const doc = await this.model
      .findOne({ publicId })
      .select("_id")
      .lean<{ _id: Types.ObjectId }>()
      .exec();
    return doc ? doc._id.toString() : null;
  }

  /**
   * Finds a user by username.
   * @param username - The username to search for.
   * @param session - (Optional) Mongoose session for transactions.
   * @returns The user object or null if not found.
   */
  async findByUsername(username: string): Promise<IUser | null> {
    try {
      const session = this.getSession();
      const query = this.model.findOne({ username }).select("+password");
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findByHandle(handle: string): Promise<IUser | null> {
    try {
      const session = this.getSession();
      const handleNormalized = handle.trim().toLowerCase();
      const query = this.model
        .findOne({ handleNormalized })
        .select("+password");
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Finds a user by email.
   * @param email - The email to search for.
   * @param session - (Optional) Mongoose session for transactions.
   * @returns The user object or null if not found.
   */
  async findByEmail(email: string): Promise<IUser | null> {
    try {
      const session = this.getSession();
      const query = this.model.findOne({ email }).select("+password");
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findByResetToken(token: string): Promise<IUser | null> {
    try {
      const session = this.getSession();
      const query = this.model
        .findOne({ resetToken: token, resetTokenExpires: { $gt: new Date() } })
        .select("+password +resetToken +resetTokenExpires");
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findByEmailVerificationToken(
    email: string,
    token: string,
  ): Promise<IUser | null> {
    try {
      const session = this.getSession();
      const query = this.model
        .findOne({
          email,
          emailVerificationToken: token,
          emailVerificationExpires: { $gt: new Date() },
        })
        .select("+emailVerificationToken +emailVerificationExpires");
      if (session) query.session(session);
      return await query.exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Retrieves paginated users from the database.
   * @param options - Pagination options (page, limit, sorting).
   * @returns A paginated result containing users.
   */
  async findWithPagination(
    options: PaginationOptions,
  ): Promise<PaginationResult<IUser>> {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
        filter = {},
      } = options;

      const skip = (page - 1) * limit;
      const sort = { [sortBy]: sortOrder };

      const [data, total] = await Promise.all([
        this.model.find(filter).sort(sort).skip(skip).limit(limit).exec(),
        this.model.countDocuments(filter),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  // Profile-specific updates

  /**
   * Updates the avatar URL of a user in the database.
   * @param {string} userId - The unique identifier of the user.
   * @param {string} avatarUrl - The new avatar URL to be set.
   * @returns {Promise<void>} - Resolves when the update is complete.
   * @throws {Error} - Throws a 'DatabaseError' if the update operation fails.
   */
  async updateAvatar(userId: string, avatarUrl: string): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(userId, {
        $set: { avatar: avatarUrl },
      });
      if (session) query.session(session);
      await query.exec();
    } catch (error) {
      logger.error(error);
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Updates the cover image URL of a user in the database.
   * @param {string} userId - The unique identifier of the user.
   * @param {string} coverUrl - The new cover image URL to be set.
   * @returns {Promise<void>} - Resolves when the update is complete.
   * @throws {Error} - Throws a 'DatabaseError' if the update operation fails.
   */
  async updateCover(userId: string, coverUrl: string): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(userId, {
        $set: { cover: coverUrl },
      });
      if (session) query.session(session);
      await query.exec();
    } catch (error) {
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async findUsersFollowing(userPublicId: string): Promise<IUser[]> {
    try {
      const user = await this.model
        .findOne({ publicId: userPublicId })
        .select("_id")
        .lean();
      if (!user?._id) {
        return [];
      }
      const userId = new Types.ObjectId(user._id.toString());
      const followerIds =
        await this.followRepository.getFollowerObjectIds(userId);
      const followerObjectIds = followerIds.reduce<Types.ObjectId[]>(
        (acc, id) => {
          try {
            acc.push(new Types.ObjectId(id));
          } catch {
            // Ignore invalid IDs
          }
          return acc;
        },
        [],
      );

      if (followerObjectIds.length === 0) {
        return [];
      }

      return await this.model
        .find({
          _id: { $in: followerObjectIds },
        })
        .select("publicId handle username avatar")
        .exec();
    } catch (error) {
      logger.error(`Error finding followers for user ${userPublicId}:`, error);
      return [];
    }
  }

  async findUsersByPublicIds(userPublicIds: string[]): Promise<IUser[]> {
    try {
      return await this.model
        .find({
          publicId: { $in: userPublicIds },
        })
        .select("publicId handle username avatar")
        .exec();
    } catch (error) {
      logger.error("Error in findUsersByPublicIds:", error);
      return [];
    }
  }

  async findUsersByUsernames(usernames: string[]): Promise<IUser[]> {
    try {
      const regexes = usernames.map((u) => new RegExp(`^${u}$`, "i"));
      return await this.model
        .find({
          username: { $in: regexes },
        })
        .select("publicId handle username avatar")
        .exec();
    } catch (error) {
      logger.error("Error in findUsersByUsernames:", error);
      return [];
    }
  }

  async findUsersByHandles(handles: string[]): Promise<IUser[]> {
    try {
      const normalizedHandles = handles
        .map((handle) => handle.trim().toLowerCase())
        .filter(Boolean);
      if (normalizedHandles.length === 0) {
        return [];
      }
      return await this.model
        .find({
          handleNormalized: { $in: normalizedHandles },
        })
        .select("publicId handle username avatar")
        .exec();
    } catch (error) {
      logger.error("Error in findUsersByHandles:", error);
      return [];
    }
  }

  /**
   * Get suggested users to follow based on engagement metrics
   * Scores users based on: follower count (40%), total post likes (30%), post count (20%), recent activity (10%)
   * @param currentUserId - ID of the current user (to exclude from suggestions)
   * @param limit - Maximum number of suggestions to return
   */
  async getSuggestedUsersToFollow(
    currentUserId: string,
    limit: number = 5,
  ): Promise<UserSuggestion[]> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const followingIds = (
        await this.followRepository.getFollowingObjectIds(currentUserId)
      )
        .map((id) => {
          try {
            return new Types.ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(
          (value): value is Types.ObjectId => value instanceof Types.ObjectId,
        );

      const result = await this.model.aggregate([
        // exclude the current user, users they already follow, and banned users
        {
          $match: {
            _id: { $ne: new Types.ObjectId(currentUserId), $nin: followingIds },
            isBanned: false,
          },
        },
        {
          $lookup: {
            from: "follows",
            localField: "_id",
            foreignField: "followeeId",
            as: "followerLinks",
          },
        },
        // lookup posts for each user
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "user",
            as: "posts",
          },
        },
        // calculate metrics
        {
          $addFields: {
            followerCount: { $size: "$followerLinks" },
            postCount: { $size: "$posts" },
            totalLikes: {
              $reduce: {
                input: "$posts",
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    {
                      $cond: [
                        { $isArray: "$$this.likes" },
                        { $size: { $ifNull: ["$$this.likes", []] } },
                        { $ifNull: ["$$this.likesCount", 0] },
                      ],
                    },
                  ],
                },
              },
            },
            recentPostCount: {
              $size: {
                $filter: {
                  input: "$posts",
                  as: "post",
                  cond: { $gte: ["$$post.createdAt", thirtyDaysAgo] },
                },
              },
            },
          },
        },
        // filter users with at least some activity
        {
          $match: {
            $or: [
              { followerCount: { $gte: 1 } },
              { postCount: { $gte: 1 } },
              { totalLikes: { $gte: 1 } },
            ],
          },
        },
        // calculate engagement score
        {
          $addFields: {
            score: {
              $add: [
                { $multiply: ["$followerCount", 0.4] },
                { $multiply: ["$totalLikes", 0.3] },
                { $multiply: ["$postCount", 0.2] },
                { $multiply: ["$recentPostCount", 0.1] },
              ],
            },
          },
        },
        // sort by score descending
        { $sort: { score: -1 } },
        // limit results
        { $limit: limit },
        // project only needed fields
        {
          $project: {
            publicId: 1,
            handle: 1,
            username: 1,
            avatar: 1,
            bio: 1,
            followerCount: 1,
            postCount: 1,
            totalLikes: 1,
            score: 1,
          },
        },
      ]);

      return result;
    } catch (error) {
      logger.error("Error in getSuggestedUsersToFollow:", error);
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Get suggested users for low-traffic mode: any user who has posted at least once
   * that the current user is not following
   * Uses simpler aggregation optimized for small user bases
   * @param currentUserId internal user ID to exclude
   * @param limit maximum results
   * @param recentlyActiveUserPublicIds optional list of publicIds to prioritize (from activity tracking)
   */
  async getSuggestedUsersLowTraffic(
    currentUserId: string,
    limit: number = 5,
    recentlyActiveUserPublicIds?: string[],
  ): Promise<UserSuggestion[]> {
    try {
      const followingIds = (
        await this.followRepository.getFollowingObjectIds(currentUserId)
      )
        .map((id) => {
          try {
            return new Types.ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(
          (value): value is Types.ObjectId => value instanceof Types.ObjectId,
        );

      // if we have recently active users from Redis, prioritize them
      let priorityUserMatch = {};
      if (
        recentlyActiveUserPublicIds &&
        recentlyActiveUserPublicIds.length > 0
      ) {
        priorityUserMatch = { publicId: { $in: recentlyActiveUserPublicIds } };
      }

      const result = await this.model.aggregate([
        // exclude current user, users already followed, and banned users
        {
          $match: {
            _id: { $ne: new Types.ObjectId(currentUserId), $nin: followingIds },
            isBanned: false,
            ...priorityUserMatch,
          },
        },
        // lookup posts for each user
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "user",
            as: "posts",
          },
        },
        // only users who have posted at least once
        {
          $match: {
            "posts.0": { $exists: true },
          },
        },
        // calculate basic metrics
        {
          $addFields: {
            postCount: { $size: "$posts" },
            totalLikes: {
              $reduce: {
                input: "$posts",
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    {
                      $cond: [
                        { $isArray: "$$this.likes" },
                        { $size: { $ifNull: ["$$this.likes", []] } },
                        { $ifNull: ["$$this.likesCount", 0] },
                      ],
                    },
                  ],
                },
              },
            },
            // get most recent post date for sorting
            lastPostDate: {
              $max: "$posts.createdAt",
            },
          },
        },
        // sort by most recent activity first
        { $sort: { lastPostDate: -1 } },
        { $limit: limit },
        // project needed fields
        {
          $project: {
            publicId: 1,
            handle: 1,
            username: 1,
            avatar: 1,
            bio: 1,
            followerCount: { $ifNull: ["$followerCount", 0] },
            postCount: 1,
            totalLikes: 1,
            score: { $literal: 0 }, // placeholder score for low traffic mode
          },
        },
      ]);

      return result;
    } catch (error) {
      logger.error("Error in getSuggestedUsersLowTraffic:", error);
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Get suggested users for high-traffic mode: users with significant engagement
   * Prioritizes regular posters and users whose posts get attention
   * @param currentUserId internal user ID to exclude
   * @param limit maximum results
   */
  async getSuggestedUsersHighTraffic(
    currentUserId: string,
    limit: number = 5,
  ): Promise<UserSuggestion[]> {
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const followingIds = (
        await this.followRepository.getFollowingObjectIds(currentUserId)
      )
        .map((id) => {
          try {
            return new Types.ObjectId(id);
          } catch {
            return null;
          }
        })
        .filter(
          (value): value is Types.ObjectId => value instanceof Types.ObjectId,
        );

      const result = await this.model.aggregate([
        // exclude current user, followed users, and banned users
        {
          $match: {
            _id: { $ne: new Types.ObjectId(currentUserId), $nin: followingIds },
            isBanned: false,
          },
        },
        // lookup posts
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "user",
            as: "posts",
          },
        },
        // lookup followers
        {
          $lookup: {
            from: "follows",
            localField: "_id",
            foreignField: "followeeId",
            as: "followerLinks",
          },
        },
        // lookup favorites (saved posts)
        {
          $lookup: {
            from: "favorites",
            let: { postIds: "$posts._id" },
            pipeline: [
              { $match: { $expr: { $in: ["$postId", "$$postIds"] } } },
            ],
            as: "favoriteLinks",
          },
        },
        // calculate engagement metrics
        {
          $addFields: {
            followerCount: { $size: "$followerLinks" },
            postCount: { $size: "$posts" },
            // posts in last 7 days (recent activity indicator)
            recentPostCount: {
              $size: {
                $filter: {
                  input: "$posts",
                  as: "post",
                  cond: { $gte: ["$$post.createdAt", sevenDaysAgo] },
                },
              },
            },
            // posts in last 30 days (consistency indicator)
            monthlyPostCount: {
              $size: {
                $filter: {
                  input: "$posts",
                  as: "post",
                  cond: { $gte: ["$$post.createdAt", thirtyDaysAgo] },
                },
              },
            },
            totalLikes: {
              $reduce: {
                input: "$posts",
                initialValue: 0,
                in: {
                  $add: [
                    "$$value",
                    {
                      $cond: [
                        { $isArray: "$$this.likes" },
                        { $size: { $ifNull: ["$$this.likes", []] } },
                        { $ifNull: ["$$this.likesCount", 0] },
                      ],
                    },
                  ],
                },
              },
            },
            // total comments on their posts
            totalComments: {
              $reduce: {
                input: "$posts",
                initialValue: 0,
                in: {
                  $add: ["$$value", { $ifNull: ["$$this.commentsCount", 0] }],
                },
              },
            },
            // how many times their posts were saved
            savedCount: { $size: "$favoriteLinks" },
          },
        },
        // filter for users with meaningful engagement
        // must have posted in last 30 days AND have some engagement
        {
          $match: {
            monthlyPostCount: { $gte: 1 },
            $or: [
              { totalLikes: { $gte: 3 } },
              { followerCount: { $gte: 2 } },
              { recentPostCount: { $gte: 2 } },
              { totalComments: { $gte: 1 } },
              { savedCount: { $gte: 1 } },
            ],
          },
        },
        // engagement score formula:
        // - recent posts (35%): regular posting is most important
        // - likes (25%): content quality indicator
        // - followers (20%): social proof
        // - comments (10%): engagement depth
        // - saves (10%): high-quality content indicator
        {
          $addFields: {
            score: {
              $add: [
                { $multiply: ["$recentPostCount", 3.5] },
                { $multiply: ["$totalLikes", 0.25] },
                { $multiply: ["$followerCount", 2] },
                { $multiply: ["$totalComments", 1] },
                { $multiply: ["$savedCount", 1] },
              ],
            },
          },
        },
        { $sort: { score: -1 } },
        { $limit: limit },
        {
          $project: {
            publicId: 1,
            handle: 1,
            username: 1,
            avatar: 1,
            bio: 1,
            followerCount: 1,
            postCount: 1,
            totalLikes: 1,
            score: 1,
          },
        },
      ]);

      return result;
    } catch (error) {
      logger.error("Error in getSuggestedUsersHighTraffic:", error);
      throw Errors.database(error instanceof Error ? error.message : String(error));
    }
  }

  async updateFollowerCount(userId: string, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        userId,
        { $inc: { followerCount: increment } },
        { session },
      );
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to update follower count",
      );
    }
  }

  async updateFollowingCount(userId: string, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        userId,
        { $inc: { followingCount: increment } },
        { session },
      );
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        (error instanceof Error ? error.message : String(error)) ??
          "failed to update following count",
      );
    }
  }
}
