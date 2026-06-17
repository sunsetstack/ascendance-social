import mongoose, { Model } from "mongoose";
import { inject, injectable } from "tsyringe";
import { IPost, PostStatus } from "@/types";
import type { IPostWriteRepository } from "../interfaces/IPostWriteRepository";
import { BaseRepository } from "../base.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId } from "@/types/branded";
import { Errors } from "@/utils/errors";

@injectable()
export class PostWriteRepository
  extends BaseRepository<IPost>
  implements IPostWriteRepository
{
  constructor(@inject(TOKENS.Models.Post) model: Model<IPost>) {
    super(model);
  }

  async incrementViewCount(postId: mongoose.Types.ObjectId): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndUpdate(
        { _id: postId },
        { $inc: { viewsCount: 1 } },
        { new: true },
      );
      if (session) query.session(session);
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateRepostCount(postId: MongoId, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.updateOne(
        { _id: postId },
        { $inc: { repostCount: increment } },
      );
      if (session) query.session(session);
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async activatePendingPost(
    postId: MongoId,
    updates: {
      image: mongoose.Types.ObjectId | null;
      tags: mongoose.Types.ObjectId[];
      slug: string;
    },
  ): Promise<IPost | null> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndUpdate(
        { _id: postId, status: "pending" },
        {
          $set: {
            ...updates,
            status: "active",
          },
          $unset: { failureReason: 1 },
        },
        { new: true },
      );
      if (session) query.session(session);
      return await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updatePostStatus(
    postId: MongoId,
    status: PostStatus,
    failureReason?: string,
  ): Promise<void> {
    try {
      const session = this.getSession();
      const update =
        failureReason === undefined
          ? { $set: { status }, $unset: { failureReason: 1 } }
          : { $set: { status, failureReason } };
      const query = this.model.updateOne({ _id: postId }, update);
      if (session) query.session(session);
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateCommentCount(postId: MongoId, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        postId,
        { $inc: { commentsCount: increment } },
        { session },
      );
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateLikeCount(postId: MongoId, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        postId,
        { $inc: { likesCount: increment } },
        { session },
      );
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async deleteManyByUserId(userId: MongoId): Promise<number> {
    try {
      const session = this.getSession();
      const query = this.model.deleteMany({ user: userId });
      if (session) query.session(session);
      const result = await query.exec();
      return result.deletedCount || 0;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateAuthorSnapshot(
    userObjectId: mongoose.Types.ObjectId,
    updates: {
      username?: string;
      avatarUrl?: string;
      displayName?: string;
      publicId?: string;
      handle?: string;
    },
  ): Promise<number> {
    try {
      const setFields: Record<string, string> = {};
      if (updates.username !== undefined) {
        setFields["author.username"] = updates.username;
      }
      if (updates.handle !== undefined) {
        setFields["author.handle"] = updates.handle;
      }
      if (updates.avatarUrl !== undefined) {
        setFields["author.avatarUrl"] = updates.avatarUrl;
      }
      if (updates.displayName !== undefined) {
        setFields["author.displayName"] = updates.displayName;
      }
      if (updates.publicId !== undefined) {
        setFields["author.publicId"] = updates.publicId;
      }

      if (Object.keys(setFields).length === 0) {
        return 0;
      }

      const result = await this.model
        .updateMany({ "author._id": userObjectId }, { $set: setFields })
        .exec();

      return result.modifiedCount || 0;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
