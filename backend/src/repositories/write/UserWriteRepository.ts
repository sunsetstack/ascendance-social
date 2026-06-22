import { Model, UpdateQuery } from "mongoose";
import { inject, injectable } from "tsyringe";
import { IUser } from "@/types";
import type {
  IUserWriteRepository,
  JoinedCommunitySnapshotUpdate,
} from "../interfaces/IUserWriteRepository";
import { BaseRepository } from "../base.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId } from "@/types/branded";
import { Errors, isMongoDBDuplicateKeyError } from "@/utils/errors";

@injectable()
export class UserWriteRepository
  extends BaseRepository<IUser>
  implements IUserWriteRepository
{
  constructor(@inject(TOKENS.Models.User) model: Model<IUser>) {
    super(model);
  }

  private withSession<TQuery extends { session(session: unknown): TQuery }>(
    query: TQuery,
  ): TQuery {
    const session = this.getSession();
    return session ? query.session(session) : query;
  }

  private throwDatabaseError(operation: string, error: unknown): never {
    throw Errors.database(
      error instanceof Error ? error.message : String(error),
      {
        context: {
          operation,
          repository: "userWriteRepository",
        },
      },
    );
  }

  private handleWriteError(error: unknown, operation: string): never {
    if (isMongoDBDuplicateKeyError(error)) {
      const field = Object.keys(error.keyValue)[0];
      throw Errors.duplicate(`${field} already exists`, {
        context: { operation, repository: "userWriteRepository" },
      });
    }
    this.throwDatabaseError(operation, error);
  }

  private async updateUser(
    filter: Record<string, unknown>,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    const query = this.model.findOneAndUpdate(filter, updateData, {
      new: true,
    });
    return await this.withSession(query).exec();
  }

  private async updateUserById(
    userId: MongoId,
    updateData: UpdateQuery<IUser>,
  ): Promise<void> {
    const query = this.model.findByIdAndUpdate(userId, updateData);
    await this.withSession(query).exec();
  }

  async create(userData: Partial<IUser>): Promise<IUser> {
    try {
      const session = this.getSession();
      const doc = new this.model(userData);
      if (session) doc.$session(session);
      return await doc.save();
    } catch (error) {
      this.handleWriteError(error, "create");
    }
  }

  async update(
    id: MongoId,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    try {
      return await this.updateUser({ _id: id }, updateData);
    } catch (error) {
      this.handleWriteError(error, "update");
    }
  }

  async updateByPublicId(
    publicId: UserPublicId,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    try {
      return await this.updateUser({ publicId }, updateData);
    } catch (error) {
      this.handleWriteError(error, "updateByPublicId");
    }
  }

  async updateAvatar(userId: MongoId, avatarUrl: string): Promise<void> {
    try {
      await this.updateUserById(userId, { $set: { avatar: avatarUrl } });
    } catch (error) {
      this.throwDatabaseError("updateAvatar", error);
    }
  }

  async updateCover(userId: MongoId, coverUrl: string): Promise<void> {
    try {
      await this.updateUserById(userId, { $set: { cover: coverUrl } });
    } catch (error) {
      this.throwDatabaseError("updateCover", error);
    }
  }

  async updateFollowerCount(userId: MongoId, increment: number): Promise<void> {
    try {
      await this.updateUserById(userId, { $inc: { followerCount: increment } });
    } catch (error) {
      this.throwDatabaseError("updateFollowerCount", error);
    }
  }

  async updateFollowingCount(
    userId: MongoId,
    increment: number,
  ): Promise<void> {
    try {
      await this.updateUserById(userId, {
        $inc: { followingCount: increment },
      });
    } catch (error) {
      this.throwDatabaseError("updateFollowingCount", error);
    }
  }

  async updateJoinedCommunitySnapshot(
    communityId: MongoId,
    snapshot: JoinedCommunitySnapshotUpdate,
  ): Promise<void> {
    const setPatch = Object.fromEntries(
      Object.entries(snapshot)
        .filter(([, value]) => value !== undefined)
        .map(([field, value]) => [
          `joinedCommunities.$[community].${field}`,
          value,
        ]),
    );

    if (Object.keys(setPatch).length === 0) {
      return;
    }

    try {
      const query = this.model.updateMany(
        { "joinedCommunities._id": communityId },
        { $set: setPatch },
        { arrayFilters: [{ "community._id": communityId }] },
      );
      await this.withSession(query).exec();
    } catch (error) {
      this.throwDatabaseError("updateJoinedCommunitySnapshot", error);
    }
  }
}
