import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { MarkAsReadCommand } from "./markAsRead.command";
import { NotificationRepository } from "@/repositories/notification.repository";
import { RedisService } from "@/services/redis.service";
import { WebSocketServer } from "@/server/socketServer";
import { emitToAuthenticatedUser } from "@/server/socket-security";
import { INotification } from "@/types";
import { Errors, isErrorWithStatusCode, wrapError } from "@/utils/errors";
import { requireNotificationRecord } from "@/utils/notification-plain";
import { logger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { asMongoId } from "@/types/branded";
import {
  EventRegistry,
  buildRealtimeEventId,
} from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";

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

      const plain = requireNotificationRecord(updatedNotification);

      try {
        await this.redisService.clearNotificationCaches([userPublicId]);
      } catch (error) {
        logger.warn("Error syncing notification read state to Redis cache", {
          notificationId,
          userPublicId,
          error,
        });
      }

      try {
        const payload = {
          ...plain,
          eventId: buildRealtimeEventId(
            EventRegistry.socketServerEvents.notificationRead,
            plain.id,
          ),
        };
        logger.info("Sending notification-read update", {
          event: "notification.mark_as_read.realtime_sending",
        });
        await emitToAuthenticatedUser(
          this.webSocketServer.getIO(),
          userPublicId,
          EventRegistry.socketServerEvents.notificationRead,
          payload,
        );
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
