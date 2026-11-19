import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetNotificationsQuery } from "./getNotifications.query";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { NotificationRecord } from "@/types";
import { wrapError } from "@/utils/errors";
import { errorLogger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";

@injectable()
export class GetNotificationsQueryHandler implements IQueryHandler<
  GetNotificationsQuery,
  NotificationRecord[]
> {
  private readonly MAX_NOTIFICATIONS_PER_USER = 200;

  constructor(
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  async execute(query: GetNotificationsQuery): Promise<NotificationRecord[]> {
    const { userId, limit = 20, before, beforeId } = query;
    const userPublicId = asUserPublicId(userId);

    try {
      if (before !== undefined) {
        return await this.notificationRepository.getNotificationsBeforeTimestamp(
          userPublicId,
          new Date(before),
          limit,
          beforeId,
        );
      }

      let cached: NotificationRecord[] | null = null;
      let token: string | null = null;
      try {
        cached = await this.redisService.getUserNotifications(userId);
      } catch (error) {
        errorLogger.warn("Failed to read notification snapshot", { userId, error });
      }

      if (cached) {
        const page = cached.slice(0, limit);
        const targetIds = page
          .filter(({ targetType }) =>
            targetType === "post" || targetType === "comment" || targetType === "conversation")
          .map(({ id }) => id);
        const existingIds = await this.notificationRepository.findExistingIds(userPublicId, targetIds);
        if (targetIds.every((id) => existingIds.has(id))) return page;
      }

      try {
        if (cached) await this.redisService.clearNotificationCaches([userId]);
        token = await this.redisService.beginNotificationBackfill(userId);
      } catch (error) {
        errorLogger.warn("Failed to start notification backfill", { userId, error });
      }

      const notifications = await this.notificationRepository.getNotifications(
        userPublicId,
        token ? this.MAX_NOTIFICATIONS_PER_USER : limit,
        0,
      );

      if (token) {
        await this.redisService.backfillNotifications(userId, token, notifications)
          .catch((error) => errorLogger.warn("Failed to backfill notifications", { userId, error }));
      }
      return notifications.slice(0, limit);
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: { operation: "getNotifications", userId },
      });
    }
  }
}
