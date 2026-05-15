import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetNotificationsQuery } from "./getNotifications.query";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { NotificationPlain } from "@/types";
import { wrapError } from "@/utils/errors";
import { normalizeNotificationPlain } from "@/utils/notification-plain";
import { errorLogger, redisLogger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";

@injectable()
export class GetNotificationsQueryHandler implements IQueryHandler<
  GetNotificationsQuery,
  NotificationPlain[]
> {
  private readonly MAX_NOTIFICATIONS_PER_USER = 200;

  constructor(
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  private toPlainNotification(notification: any): NotificationPlain {
    const raw =
      typeof notification === "object" &&
      notification !== null &&
      "toJSON" in notification &&
      typeof notification.toJSON === "function"
        ? notification.toJSON()
        : notification;

    return normalizeNotificationPlain(raw) ?? {};
  }

  async execute(query: GetNotificationsQuery): Promise<NotificationPlain[]> {
    const { userId, limit = 20, before } = query;
    redisLogger.debug(`getNotifications called`, { userId, before, limit });

    try {
      if (before) {
        redisLogger.info(`Cursor-based pagination, fetching from DB`, {
          userId,
          before,
        });
        const beforeDate = new Date(before);
        const dbNotifications =
          await this.notificationRepository.getNotificationsBeforeTimestamp(
            asUserPublicId(userId),
            beforeDate,
            limit,
          );
        redisLogger.debug(`DB returned notifications`, {
          userId,
          count: dbNotifications.length,
        });
        return dbNotifications.map((notification) =>
          this.toPlainNotification(notification),
        );
      }

      const notifications = await this.redisService.getUserNotifications(
        userId,
        1,
        limit,
      );

      if (notifications.length >= limit) {
        redisLogger.info(`Notification Redis HIT`, {
          userId,
          count: notifications.length,
        });
        return notifications;
      }

      redisLogger.info(`Notification Redis MISS, fetching from DB`, { userId });

      const allRecentNotifications =
        await this.notificationRepository.getNotifications(
          asUserPublicId(userId),
          this.MAX_NOTIFICATIONS_PER_USER,
          0,
        );

      redisLogger.debug(`DB returned notifications for backfill`, {
        userId,
        count: allRecentNotifications.length,
      });

      if (allRecentNotifications.length > 0) {
        this.redisService
          .backfillNotifications(
            userId,
            allRecentNotifications,
            this.MAX_NOTIFICATIONS_PER_USER,
          )
          .catch((err: Error) => {
            errorLogger.error(`Failed to backfill notification cache`, {
              userId,
              error: err.message,
            });
          });
      }

      return allRecentNotifications
        .slice(0, limit)
        .map((notification) => this.toPlainNotification(notification));
    } catch (error) {
      errorLogger.error(`getNotifications error`, {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw wrapError(error, "InternalServerError", {
        context: { operation: "getNotifications", userId: query.userId },
      });
    }
  }
}
