import mongoose, { FilterQuery, Model } from "mongoose";
import { inject, injectable } from "tsyringe";
import { IPost, PostStatus } from "@/types";
import type { AuthorSnapshot, IPostWriteRepository } from "../interfaces/IPostWriteRepository";
import { BaseRepository } from "../base.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, PostPublicId } from "@/types/branded";
import { Errors } from "@/utils/errors";
import type { ContentFeatures } from "@/services/feed/interests.policy";

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
        { cause: error },
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
        { cause: error },
      );
    }
  }

  async activatePendingPost(
    postId: MongoId,
    updates: {
      image: mongoose.Types.ObjectId | null;
      tags: mongoose.Types.ObjectId[];
      slug: string;
      contentFeatures?: ContentFeatures;
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
        { cause: error },
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
        { cause: error },
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
        { cause: error },
      );
    }
  }

  async updateLikeCount(postId: MongoId, increment: number): Promise<boolean> {
    try {
      const session = this.getSession();
      const result = await this.model.updateOne(
        { _id: postId },
        { $inc: { likesCount: increment, likesRevision: 1 } },
        { session },
      ).exec();
      return result.matchedCount === 1;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
        { cause: error },
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
        { cause: error },
      );
    }
  }

  async updateAuthorSnapshot(
    userObjectId: mongoose.Types.ObjectId,
    snapshot: AuthorSnapshot,
    profileRevision: number,
    postPublicId?: PostPublicId,
  ): Promise<number> {
    try {
      const setFields = {
        "author.profileRevision": profileRevision,
        "author.username": snapshot.username,
        "author.handle": snapshot.handle,
        "author.avatarUrl": snapshot.avatarUrl,
        "author.displayName": snapshot.displayName,
        "author.publicId": snapshot.publicId,
      };

      const filter: FilterQuery<IPost> = {
        "author._id": userObjectId,
        ...(postPublicId ? { publicId: postPublicId } : {}),
        $or: [
          { "author.profileRevision": { $lt: profileRevision } },
          { "author.profileRevision": { $exists: false } },
        ],
      };
      let lastId: mongoose.Types.ObjectId | undefined;
      let modifiedCount = 0;
      while (true) {
        const posts = await this.model
          .find({ ...filter, ...(lastId ? { _id: { $gt: lastId } } : {}) })
          .select("_id")
          .sort({ _id: 1 })
          .limit(500)
          .lean()
          .exec();
        if (posts.length === 0) return modifiedCount;

        const result = await this.model.updateMany(
          { ...filter, _id: { $in: posts.map((post) => post._id) } },
          { $set: setFields },
        ).exec();
        modifiedCount += result.modifiedCount;
        lastId = posts[posts.length - 1]!._id;
      }
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }
}
