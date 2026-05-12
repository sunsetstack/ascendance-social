import { inject, injectable } from "tsyringe";
import { GetDashboardStatsQuery } from "./getDashboardStats.query";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { ImageRepository } from "@/repositories/image.repository";
import { TOKENS } from "@/types/tokens";

export interface DashboardStatsResult {
  totalUsers: number;
  totalImages: number;
  bannedUsers: number;
  adminUsers: number;
  recentUsers: number;
  recentImages: number;
  growthRate: {
    users: number;
    images: number;
  };
}

@injectable()
export class GetDashboardStatsQueryHandler implements IQueryHandler<
  GetDashboardStatsQuery,
  DashboardStatsResult
> {
  constructor(
    @inject(TOKENS.Repositories.UserRead)
    private readonly userRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Image)
    private readonly imageRepository: ImageRepository,
  ) {}

  async execute(_query: GetDashboardStatsQuery): Promise<DashboardStatsResult> {
    const [
      totalUsers,
      totalImages,
      bannedUsers,
      adminUsers,
      recentUsers,
      recentImages,
    ] = await Promise.all([
      this.userRepository.countDocuments({}),
      this.imageRepository.countDocuments({}),
      this.userRepository.countDocuments({ isBanned: true }),
      this.userRepository.countDocuments({ isAdmin: true }),
      this.userRepository.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      }),
      this.imageRepository.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    return {
      totalUsers,
      totalImages,
      bannedUsers,
      adminUsers,
      recentUsers,
      recentImages,
      growthRate: {
        users: recentUsers,
        images: recentImages,
      },
    };
  }
}
