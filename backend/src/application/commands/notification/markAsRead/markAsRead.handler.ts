import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { MarkAsReadCommand } from "./markAsRead.command";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { WebSocketServer } from "@/server/socketServer";
import { INotification, NotificationPlain } from "@/types";
import { Errors, isErrorWithStatusCode, wrapError } from "@/utils/errors";
import { normalizeNotificationPlain } from "@/utils/notification-plain";
import { logger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { asMongoId } from "@/types/branded";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";

type NotificationWithToJSON = INotification & {
  toJSON?: () => NotificationPlain;
};

@injectable()
export class MarkAsReadCommandHandler implements ICommandHandler<
  MarkAsReadCommand,
  INotification
> {
  constructor(
    @inject(TOKENS.Models.WebSocketServer)
    private readonly webSocketServer: WebSocketServer,
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  private toPlainNotification(
    notification: INotification | NotificationPlain,
  ): NotificationPlain {
    const notificationWithToJSON = notification as NotificationWithToJSON;
    const raw =
      typeof notification === "object" &&
      notification !== null &&
      typeof notificationWithToJSON.toJSON === "function"
        ? notificationWithToJSON.toJSON()
        : notification;

    return normalizeNotificationPlain(raw) ?? {};
  }

  async execute(command: MarkAsReadCommand): Promise<INotification> {
    try {
      const { notificationId, userPublicId } = command;
      logger.info(`[MarkAsReadCommandHandler] markAsRead requested`, {
        notificationId,
        userPublicId,
      });

      const updatedNotification = await this.notificationRepository.markAsRead(
        asMongoId(notificationId),
        userPublicId,
      );

      if (!updatedNotification) {
        logger.info(`[MarkAsReadCommandHandler] markAsRead not found`, {
          notificationId,
          userPublicId,
        });
        throw Errors.notFound("Notification");
      }

      logger.info(`[MarkAsReadCommandHandler] markAsRead updated`, {
        notificationId,
        userPublicId,
      });

      try {
        await this.redisService.markNotificationRead(notificationId);
      } catch (error) {
        logger.warn("Error syncing notification read state to Redis cache", {
          notificationId,
          userPublicId,
          error,
        });
      }

      try {
        const plain = this.toPlainNotification(updatedNotification);
        const payload = {
          ...plain,
          eventId: buildRealtimeEventId(
            EventRegistry.socketServerEvents.notificationRead,
            plain.id ?? plain._id ?? notificationId,
          ),
        };
        logger.info(`Sending notification_read to user ${userPublicId}:`, {
          notification: payload,
        });
        this.webSocketServer
          .getIO()
          .to(userPublicId)
          .emit(EventRegistry.socketServerEvents.notificationRead, payload);
        this.metricsService.recordSocketEventEmitted(
          EventRegistry.socketServerEvents.notificationRead,
          "room",
        );
        logger.info("Notification read event sent successfully");
      } catch (error) {
        logger.warn("Error sending notification read event", {
          notificationId,
          userPublicId,
          error,
        });
      }

      return updatedNotification;
    } catch (error) {
      if (isErrorWithStatusCode(error)) throw error;
      throw wrapError(error, "InternalServerError", {
        context: {
          operation: "markAsRead",
          notificationId: command.notificationId,
          userPublicId: command.userPublicId,
        },
      });
    }
  }
}
