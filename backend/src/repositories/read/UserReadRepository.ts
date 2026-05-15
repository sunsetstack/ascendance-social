import { inject, injectable } from "tsyringe";
import {
  IUser,
  PaginationOptions,
  PaginationResult,
  UserSuggestion,
} from "@/types";
import type { IUserReadRepository } from "../interfaces/IUserReadRepository";
import { UserRepository } from "../user.repository";
import { TOKENS } from "@/types/tokens";
import { MongoId, UserPublicId } from "@/types/branded";

/**
 * Read-only repository for user queries
 * delegates to the existing UserRepository for now
 * can be pointed to a read replica connection in the future
 */
@injectable()
export class UserReadRepository implements IUserReadRepository {
  constructor(
    @inject(TOKENS.Repositories.User)
    private readonly userRepository: UserRepository,
  ) {}

  async findById(id: MongoId): Promise<IUser | null> {
    return this.userRepository.findById(id);
  }

  async findByPublicId(publicId: UserPublicId): Promise<IUser | null> {
    return this.userRepository.findByPublicId(publicId);
  }

  async findInternalIdByPublicId(
    publicId: UserPublicId,
  ): Promise<MongoId | null> {
    return this.userRepository.findInternalIdByPublicId(publicId);
  }

  async findByUsername(username: string): Promise<IUser | null> {
    return this.userRepository.findByUsername(username);
  }

  async findByHandle(handle: string): Promise<IUser | null> {
    return this.userRepository.findByHandle(handle);
  }

  async findByEmail(email: string): Promise<IUser | null> {
    return this.userRepository.findByEmail(email);
  }

  async findByResetToken(token: string): Promise<IUser | null> {
    return this.userRepository.findByResetToken(token);
  }

  async findByEmailVerificationToken(
    email: string,
    token: string,
  ): Promise<IUser | null> {
    return this.userRepository.findByEmailVerificationToken(email, token);
  }

  async findUsersByPublicIds(userPublicIds: UserPublicId[]): Promise<IUser[]> {
    return this.userRepository.findUsersByPublicIds(userPublicIds);
  }

  async findUsersByUsernames(usernames: string[]): Promise<IUser[]> {
    return this.userRepository.findUsersByUsernames(usernames);
  }

  async findUsersByHandles(handles: string[]): Promise<IUser[]> {
    return this.userRepository.findUsersByHandles(handles);
  }

  async findUsersFollowing(userPublicId: UserPublicId): Promise<IUser[]> {
    return this.userRepository.findUsersFollowing(userPublicId);
  }

  async getAll(options: {
    search?: string[];
    page?: number;
    limit?: number;
  }): Promise<IUser[] | null> {
    return this.userRepository.getAll(options);
  }

  async findWithPagination(
    options: PaginationOptions,
  ): Promise<PaginationResult<IUser>> {
    return this.userRepository.findWithPagination(options);
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.userRepository.countDocuments(filter);
  }

  async getSuggestedUsersToFollow(
    currentUserId: MongoId,
    limit?: number,
  ): Promise<UserSuggestion[]> {
    return this.userRepository.getSuggestedUsersToFollow(currentUserId, limit);
  }

  async getSuggestedUsersLowTraffic(
    currentUserId: MongoId,
    limit?: number,
    recentlyActiveUserPublicIds?: UserPublicId[],
  ): Promise<UserSuggestion[]> {
    return this.userRepository.getSuggestedUsersLowTraffic(
      currentUserId,
      limit,
      recentlyActiveUserPublicIds,
    );
  }

  async getSuggestedUsersHighTraffic(
    currentUserId: MongoId,
    limit?: number,
  ): Promise<UserSuggestion[]> {
    return this.userRepository.getSuggestedUsersHighTraffic(
      currentUserId,
      limit,
    );
  }
}
