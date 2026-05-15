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
  ) {}

  private toPlainNotification(
    notification: INotification | NotificationPlain,
  ): NotificationPlain {
    const raw =
      typeof notification === "object" &&
      notification !== null &&
      "toJSON" in notification &&
      typeof (notification as any).toJSON === "function"
        ? (notification as any).toJSON()
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
        const plain = this.toPlainNotification(updatedNotification);
        logger.info(`Sending notification_read to user ${userPublicId}:`, {
          notification: plain,
        });
        this.webSocketServer
          .getIO()
          .to(userPublicId)
          .emit("notification_read", plain);
        logger.info("Notification read event sent successfully");
      } catch (error) {
        logger.error("Error sending notification read event:", { error });
        throw wrapError(error);
      }

      await this.redisService.markNotificationRead(notificationId);

      return updatedNotification as any;
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
