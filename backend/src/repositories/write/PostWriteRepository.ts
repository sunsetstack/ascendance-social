import mongoose from "mongoose";
import { inject, injectable } from "tsyringe";
import { IPost } from "@/types";
import type { IPostWriteRepository } from "../interfaces/IPostWriteRepository";
import { PostRepository } from "../post.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId } from "@/types/branded";

/**
 * Write-only repository for post mutations
 * delegates to the existing PostRepository for now
 * command handlers use this for all write operations
 */
@injectable()
export class PostWriteRepository implements IPostWriteRepository {
  constructor(
    @inject(TOKENS.Repositories.Post)
    private readonly postRepository: PostRepository,
  ) {}

  async create(item: Partial<IPost>): Promise<IPost> {
    return this.postRepository.create(item);
  }

  async update(id: MongoId, item: Partial<IPost>): Promise<IPost | null> {
    return this.postRepository.update(id, item);
  }

  async delete(id: MongoId): Promise<boolean> {
    return this.postRepository.delete(id);
  }

  async incrementViewCount(postId: mongoose.Types.ObjectId): Promise<void> {
    return this.postRepository.incrementViewCount(postId);
  }

  async updateCommentCount(postId: MongoId, increment: number): Promise<void> {
    return this.postRepository.updateCommentCount(postId, increment);
  }

  async updateLikeCount(postId: MongoId, increment: number): Promise<void> {
    return this.postRepository.updateLikeCount(postId, increment);
  }

  async updateRepostCount(postId: MongoId, increment: number): Promise<void> {
    return this.postRepository.updateRepostCount(postId, increment);
  }

  async deleteManyByUserId(userId: MongoId): Promise<number> {
    return this.postRepository.deleteManyByUserId(userId);
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
    return this.postRepository.updateAuthorSnapshot(userObjectId, updates);
  }
}
