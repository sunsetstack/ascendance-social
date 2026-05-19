import { FilterQuery, Model, Types } from "mongoose";
import { inject, injectable } from "tsyringe";
import {
  IUser,
  PaginationOptions,
  PaginationResult,
  UserSuggestion,
} from "@/types";
import type { IUserReadRepository } from "../interfaces/IUserReadRepository";
import { BaseRepository } from "../base.repository";
import { FollowRepository } from "../follow.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId, asMongoId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { escapeRegex } from "@/utils/sanitizers";

@injectable()
export class UserReadRepository
  extends BaseRepository<IUser>
  implements IUserReadRepository
{
  constructor(
    @inject(TOKENS.Models.User) model: Model<IUser>,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
  ) {
    super(model);
  }

  private withSession<TQuery extends { session(session: unknown): TQuery }>(
    query: TQuery,
  ): TQuery {
    const session = this.getSession();
    return session ? query.session(session) : query;
  }

  private throwDatabaseError(
    operation: string,
    error: unknown,
    context: Record<string, unknown> = {},
  ): never {
    throw Errors.database(
      error instanceof Error ? error.message : String(error),
      {
        context: {
          operation,
          repository: "userReadRepository",
          ...context,
        },
      },
    );
  }

  private async findUser(
    filter: FilterQuery<IUser>,
    select?: string,
  ): Promise<IUser | null> {
    const query = this.model.findOne(filter);
    if (select) {
      query.select(select);
    }
    return await this.withSession(query).exec();
  }

  private normalizeHandles(handles: string[]): string[] {
    return handles.map((handle) => handle.trim().toLowerCase()).filter(Boolean);
  }

  private toObjectIds(ids: string[]): Types.ObjectId[] {
    return ids.reduce<Types.ObjectId[]>((acc, id) => {
      try {
        acc.push(new Types.ObjectId(id));
      } catch {
        // ignore invalid ids
      }
      return acc;
    }, []);
  }

  private buildCaseInsensitiveRegexes(values: string[]): RegExp[] {
    return values.map((value) => new RegExp(`^${escapeRegex(value)}$`, "i"));
  }

  private async findPublicUsers(
    filter: FilterQuery<IUser>,
    operation: string,
  ): Promise<IUser[]> {
    try {
      return await this.model
        .find(filter)
        .select("publicId handle username avatar")
        .exec();
    } catch (error) {
      logger.error(`UserReadRepository.${operation} failed`, { error });
      return [];
    }
  }

  async findByPublicId(publicId: UserPublicId): Promise<IUser | null> {
    return await this.findUser({ publicId });
  }

  async findInternalIdByPublicId(
    publicId: UserPublicId,
  ): Promise<MongoId | null> {
    const query = this.model.findOne({ publicId }).select("_id").lean<{
      _id: Types.ObjectId;
    }>();
    const doc = await this.withSession(query).exec();
    return doc ? asMongoId(doc._id.toString()) : null;
  }

  async findByUsername(username: string): Promise<IUser | null> {
    try {
      return await this.findUser({ username }, "+password");
    } catch (error) {
      this.throwDatabaseError("findByUsername", error);
    }
  }

  async findByHandle(handle: string): Promise<IUser | null> {
    try {
      const handleNormalized = handle.trim().toLowerCase();
      return await this.findUser({ handleNormalized }, "+password");
    } catch (error) {
      this.throwDatabaseError("findByHandle", error);
    }
  }

  async findByEmail(email: string): Promise<IUser | null> {
    try {
      return await this.findUser({ email }, "+password");
    } catch (error) {
      this.throwDatabaseError("findByEmail", error);
    }
  }

  async findByResetToken(token: string): Promise<IUser | null> {
    try {
      return await this.findUser(
        { resetToken: token, resetTokenExpires: { $gt: new Date() } },
        "+password +resetToken +resetTokenExpires",
      );
    } catch (error) {
      this.throwDatabaseError("findByResetToken", error);
    }
  }

  async findByEmailVerificationToken(
    email: string,
    token: string,
  ): Promise<IUser | null> {
    try {
      return await this.findUser(
        {
          email,
          emailVerificationToken: token,
          emailVerificationExpires: { $gt: new Date() },
        },
        "+emailVerificationToken +emailVerificationExpires",
      );
    } catch (error) {
      this.throwDatabaseError("findByEmailVerificationToken", error);
    }
  }

  async findUsersFollowing(userPublicId: UserPublicId): Promise<IUser[]> {
    try {
      const userId = await this.findInternalIdByPublicId(userPublicId);
      if (!userId) {
        return [];
      }

      const followerIds = await this.followRepository.getFollowerObjectIds(
        new Types.ObjectId(userId),
      );
      const followerObjectIds = this.toObjectIds(followerIds);

      if (followerObjectIds.length === 0) {
        return [];
      }

      return await this.findPublicUsers(
        { _id: { $in: followerObjectIds } },
        "findUsersFollowing",
      );
    } catch (error) {
      logger.error("UserReadRepository.findUsersFollowing failed", {
        userPublicId,
        error,
      });
      return [];
    }
  }

  async findUsersByPublicIds(userPublicIds: UserPublicId[]): Promise<IUser[]> {
    return await this.findPublicUsers(
      { publicId: { $in: userPublicIds } },
      "findUsersByPublicIds",
    );
  }

  async findUsersByUsernames(usernames: string[]): Promise<IUser[]> {
    return await this.findPublicUsers(
      { username: { $in: this.buildCaseInsensitiveRegexes(usernames) } },
      "findUsersByUsernames",
    );
  }

  async findUsersByHandles(handles: string[]): Promise<IUser[]> {
    const normalizedHandles = this.normalizeHandles(handles);
    if (normalizedHandles.length === 0) {
      return [];
    }

    return await this.findPublicUsers(
      { handleNormalized: { $in: normalizedHandles } },
      "findUsersByHandles",
    );
  }

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
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
        {
          context: { operation: "getAll", options },
        },
      );
    }
  }

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
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  async getSuggestedUsersToFollow(
    currentUserId: MongoId,
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

      return await this.model.aggregate([
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
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "user",
            as: "posts",
          },
        },
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
        {
          $match: {
            $or: [
              { followerCount: { $gte: 1 } },
              { postCount: { $gte: 1 } },
              { totalLikes: { $gte: 1 } },
            ],
          },
        },
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
    } catch (error) {
      logger.error("UserReadRepository.getSuggestedUsersToFollow failed", {
        error,
      });
      this.throwDatabaseError("getSuggestedUsersToFollow", error);
    }
  }

  async getSuggestedUsersLowTraffic(
    currentUserId: MongoId,
    limit: number = 5,
    recentlyActiveUserPublicIds?: UserPublicId[],
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

      let priorityUserMatch = {};
      if (
        recentlyActiveUserPublicIds &&
        recentlyActiveUserPublicIds.length > 0
      ) {
        priorityUserMatch = { publicId: { $in: recentlyActiveUserPublicIds } };
      }

      return await this.model.aggregate([
        {
          $match: {
            _id: { $ne: new Types.ObjectId(currentUserId), $nin: followingIds },
            isBanned: false,
            ...priorityUserMatch,
          },
        },
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "user",
            as: "posts",
          },
        },
        {
          $match: {
            "posts.0": { $exists: true },
          },
        },
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
            lastPostDate: {
              $max: "$posts.createdAt",
            },
          },
        },
        { $sort: { lastPostDate: -1 } },
        { $limit: limit },
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
            score: { $literal: 0 },
          },
        },
      ]);
    } catch (error) {
      logger.error("UserReadRepository.getSuggestedUsersLowTraffic failed", {
        error,
      });
      this.throwDatabaseError("getSuggestedUsersLowTraffic", error);
    }
  }

  async getSuggestedUsersHighTraffic(
    currentUserId: MongoId,
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

      return await this.model.aggregate([
        {
          $match: {
            _id: { $ne: new Types.ObjectId(currentUserId), $nin: followingIds },
            isBanned: false,
          },
        },
        {
          $lookup: {
            from: "posts",
            localField: "_id",
            foreignField: "user",
            as: "posts",
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
        {
          $addFields: {
            followerCount: { $size: "$followerLinks" },
            postCount: { $size: "$posts" },
            recentPostCount: {
              $size: {
                $filter: {
                  input: "$posts",
                  as: "post",
                  cond: { $gte: ["$$post.createdAt", sevenDaysAgo] },
                },
              },
            },
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
            totalComments: {
              $reduce: {
                input: "$posts",
                initialValue: 0,
                in: {
                  $add: ["$$value", { $ifNull: ["$$this.commentsCount", 0] }],
                },
              },
            },
            savedCount: { $size: "$favoriteLinks" },
          },
        },
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
    } catch (error) {
      logger.error("UserReadRepository.getSuggestedUsersHighTraffic failed", {
        error,
      });
      this.throwDatabaseError("getSuggestedUsersHighTraffic", error);
    }
  }
}
