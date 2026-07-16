import { inject, injectable } from "tsyringe";
import { GetDashboardStatsQuery } from "./getDashboardStats.query";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import type { IUserReadRepository } from "@/repositories/interfaces/IUserReadRepository";
import { ImageRepository } from "@/repositories/image.repository";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { AuthActivityLogRepository } from "@/repositories/authActivityLog.repository";
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
  operations: {
    requestsLast24Hours: number;
    serverErrorsLast24Hours: number;
    slowRequestsLast24Hours: number;
    averageResponseTimeMs: number;
    failedAuthAttemptsLast24Hours: number;
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
    @inject(TOKENS.Repositories.RequestLog)
    private readonly requestLogRepository: RequestLogRepository,
    @inject(TOKENS.Repositories.AuthActivityLog)
    private readonly authActivityLogRepository: AuthActivityLogRepository,
  ) {}

  async execute(_query: GetDashboardStatsQuery): Promise<DashboardStatsResult> {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const [
      totalUsers,
      totalImages,
      bannedUsers,
      adminUsers,
      recentUsers,
      recentImages,
      requestLogSummary,
      failedAuthAttemptsLast24Hours,
    ] = await Promise.all([
      this.userRepository.countDocuments({}),
      this.imageRepository.countDocuments({}),
      this.userRepository.countDocuments({ isBanned: true }),
      this.userRepository.countDocuments({ isAdmin: true }),
      this.userRepository.countDocuments({
        createdAt: { $gte: monthAgo },
      }),
      this.imageRepository.countDocuments({
        createdAt: { $gte: monthAgo },
      }),
      this.requestLogRepository.getOperationalSummary(dayAgo),
      this.authActivityLogRepository.countFailedAttempts(dayAgo),
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
      operations: {
        requestsLast24Hours: requestLogSummary.totalRequests,
        serverErrorsLast24Hours: requestLogSummary.serverErrors,
        slowRequestsLast24Hours: requestLogSummary.slowRequests,
        averageResponseTimeMs: requestLogSummary.averageResponseTimeMs,
        failedAuthAttemptsLast24Hours,
      },
    };
  }
}
