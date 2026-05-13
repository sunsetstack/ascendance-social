import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetUnreadCountQuery } from "./getUnreadCount.query";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { logger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetUnreadCountQueryHandler
  implements IQueryHandler<GetUnreadCountQuery, number>
{
  constructor(
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  async execute(query: GetUnreadCountQuery): Promise<number> {
    const { userPublicId } = query;
    try {
      return await this.redisService.getUnreadNotificationCount(userPublicId);
    } catch (error) {
      logger.warn(
        `[GetUnreadCountQueryHandler] Redis error getting unread count, falling back to DB:`,
        { error },
      );
      return await this.notificationRepository.getUnreadCount(userPublicId);
    }
  }
}
