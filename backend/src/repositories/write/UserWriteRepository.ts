import { UpdateQuery } from "mongoose";
import { inject, injectable } from "tsyringe";
import { IUser } from "@/types";
import type { IUserWriteRepository } from "../interfaces/IUserWriteRepository";
import { UserRepository } from "../user.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId } from "@/types/branded";

/**
 * Write-only repository for user mutations
 * delegates to the existing UserRepository for now
 * command handlers use this for all write operations
 */
@injectable()
export class UserWriteRepository implements IUserWriteRepository {
  constructor(
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
  ) {}

  async create(userData: Partial<IUser>): Promise<IUser> {
    return this.userRepository.create(userData);
  }

  async update(
    id: MongoId,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    return this.userRepository.update(id, updateData);
  }

  async updateByPublicId(
    publicId: UserPublicId,
    updateData: UpdateQuery<IUser>,
  ): Promise<IUser | null> {
    return this.userRepository.updateByPublicId(publicId, updateData);
  }

  async delete(id: MongoId): Promise<boolean> {
    return this.userRepository.delete(id);
  }

  async updateAvatar(userId: MongoId, avatarUrl: string): Promise<void> {
    return this.userRepository.updateAvatar(userId, avatarUrl);
  }

  async updateCover(userId: MongoId, coverUrl: string): Promise<void> {
    return this.userRepository.updateCover(userId, coverUrl);
  }

  async updateFollowerCount(userId: MongoId, increment: number): Promise<void> {
    return this.userRepository.updateFollowerCount(userId, increment);
  }

  async updateFollowingCount(
    userId: MongoId,
    increment: number,
  ): Promise<void> {
    return this.userRepository.updateFollowingCount(userId, increment);
  }
}
