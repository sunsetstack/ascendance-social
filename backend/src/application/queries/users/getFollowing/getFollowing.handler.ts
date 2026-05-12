import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetFollowingQuery } from "./getFollowing.query";
import { inject, injectable } from "tsyringe";
import { FollowRepository } from "@/repositories/follow.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

export interface FollowUserItem {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  bio?: string;
}

export interface GetFollowingResult {
  users: FollowUserItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@injectable()
export class GetFollowingQueryHandler implements IQueryHandler<
  GetFollowingQuery,
  GetFollowingResult
> {
  constructor(
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
  ) {}

  async execute(query: GetFollowingQuery): Promise<GetFollowingResult> {
    try {
      const user = await this.userReadRepository.findByPublicId(
        query.userPublicId,
      );
      if (!user) {
        throw Errors.notFound("User");
      }

      const { ids: followingIds, total } =
        await this.followRepository.getFollowingObjectIdsPaginated(
          String(user._id),
          query.page,
          query.limit,
        );
      const totalPages = Math.ceil(total / query.limit);

      if (followingIds.length === 0) {
        return {
          users: [],
          total,
          page: query.page,
          limit: query.limit,
          totalPages,
        };
      }

      const followingUsers = await this.userReadRepository.findWithPagination({
        page: 1,
        limit: followingIds.length,
        filter: { _id: { $in: followingIds } },
      });
      const usersById = new Map(
        followingUsers.data.map((entry) => [entry._id.toString(), entry]),
      );
      const users: FollowUserItem[] = followingIds
        .map((id) => usersById.get(id))
        .filter(
          (entry): entry is (typeof followingUsers.data)[number] => !!entry,
        )
        .map((followingUser) => ({
          publicId: followingUser.publicId,
          handle: followingUser.handle,
          username: followingUser.username,
          avatar: followingUser.avatar || "",
          bio: followingUser.bio,
        }));

      return {
        users,
        total,
        page: query.page,
        limit: query.limit,
        totalPages,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw Errors.internal("Failed to get following");
    }
  }
}
