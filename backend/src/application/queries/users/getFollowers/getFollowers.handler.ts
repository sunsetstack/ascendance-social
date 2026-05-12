import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetFollowersQuery } from "./getFollowers.query";
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

export interface GetFollowersResult {
  users: FollowUserItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@injectable()
export class GetFollowersQueryHandler implements IQueryHandler<
  GetFollowersQuery,
  GetFollowersResult
> {
  constructor(
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
  ) {}

  async execute(query: GetFollowersQuery): Promise<GetFollowersResult> {
    try {
      const user = await this.userReadRepository.findByPublicId(
        query.userPublicId,
      );
      if (!user) {
        throw Errors.notFound("User");
      }

      const { ids: followerIds, total } =
        await this.followRepository.getFollowerObjectIdsPaginated(
          String(user._id),
          query.page,
          query.limit,
        );
      const totalPages = Math.ceil(total / query.limit);

      if (followerIds.length === 0) {
        return {
          users: [],
          total,
          page: query.page,
          limit: query.limit,
          totalPages,
        };
      }

      const followerUsers = await this.userReadRepository.findWithPagination({
        page: 1,
        limit: followerIds.length,
        filter: { _id: { $in: followerIds } },
      });
      const usersById = new Map(
        followerUsers.data.map((entry) => [entry._id.toString(), entry]),
      );
      const users: FollowUserItem[] = followerIds
        .map((id) => usersById.get(id))
        .filter(
          (entry): entry is (typeof followerUsers.data)[number] => !!entry,
        )
        .map((followerUser) => ({
          publicId: followerUser.publicId,
          handle: followerUser.handle,
          username: followerUser.username,
          avatar: followerUser.avatar || "",
          bio: followerUser.bio,
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
      throw Errors.internal("Failed to get followers");
    }
  }
}
