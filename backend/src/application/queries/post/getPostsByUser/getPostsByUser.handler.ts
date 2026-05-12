import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetPostsByUserQuery } from "./getPostsByUser.query";
import type { IPostReadRepository } from "@/repositories/interfaces";
import { DTOService, PublicUserDTO } from "@/services/dto.service";
import { UserPostsResult } from "@/types";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { FollowRepository } from "@/repositories/follow.repository";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetPostsByUserQueryHandler implements IQueryHandler<
  GetPostsByUserQuery,
  UserPostsResult
> {
  constructor(
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
  ) {}

  async execute(query: GetPostsByUserQuery): Promise<UserPostsResult> {
    const [result, user] = await Promise.all([
      this.postReadRepository.findByUserPublicId(query.userPublicId, {
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      }),
      this.userReadRepository.findByPublicId(query.userPublicId),
    ]);

    if (!user) {
      throw Errors.notFound("User");
    }

    // attach follow counts
    const userId = user._id!.toString();
    const [followerCount, followingCount] = await Promise.all([
      this.followRepository.countFollowersByUserId(userId),
      this.followRepository.countFollowingByUserId(userId),
    ]);

    // set follow counts on the user object
    user.followerCount = followerCount;
    user.followingCount = followingCount;

    const profile: PublicUserDTO = this.dtoService.toPublicDTO(user);

    return {
      ...result,
      data: result.data.map((entry) => this.dtoService.toPostDTO(entry)),
      profile,
    };
  }
}
