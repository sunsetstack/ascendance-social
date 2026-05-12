import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetUserStatsQuery } from "./getUserStats.query";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { ImageRepository } from "@/repositories/image.repository";
import { FollowRepository } from "@/repositories/follow.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { DTOService, AdminUserDTO } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { TOKENS } from "@/types/tokens";

export interface UserStatsResult {
  user: AdminUserDTO;
  stats: {
    imageCount: number;
    followerCount: number;
    followingCount: number;
    likeCount: number;
    joinDate: Date;
    lastActivity: Date;
    lastIp?: string;
  };
}

@injectable()
export class GetUserStatsQueryHandler implements IQueryHandler<
  GetUserStatsQuery,
  UserStatsResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Image)
    private readonly imageRepository: ImageRepository,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.Repositories.PostLike)
    private readonly postLikeRepository: PostLikeRepository,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
  ) {}

  async execute(query: GetUserStatsQuery): Promise<UserStatsResult> {
    const user = await this.userReadRepository.findByPublicId(
      query.userPublicId,
    );
    if (!user) {
      throw Errors.notFound("User");
    }

    const [imageCount, followerCount, followingCount, likeCount] =
      await Promise.all([
        this.imageRepository.countDocuments({ user: user.id }),
        this.followRepository.countDocuments({ followeeId: user.id }),
        this.followRepository.countDocuments({ followerId: user.id }),
        this.postLikeRepository.countLikesByUser(user.id),
      ]);

    return {
      user: this.dtoService.toAdminDTO(user),
      stats: {
        imageCount,
        followerCount,
        followingCount,
        likeCount,
        joinDate: user.createdAt,
        lastActivity: user.lastActive || user.updatedAt,
        lastIp: user.lastIp,
      },
    };
  }
}
