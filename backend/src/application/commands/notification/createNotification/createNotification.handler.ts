import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { CreateNotificationCommand } from "./createNotification.command";
import { NotificationRepository } from "@/repositories/notification.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { RedisService } from "@/services/redis.service";
import { WebSocketServer } from "@/server/socketServer";
import { INotification, NotificationPlain } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import { normalizeNotificationPlain } from "@/utils/notification-plain";
import { SystemActor } from "@/utils/actors/SystemActor";
import { logger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  asUserPublicId,
  PostPublicId,
  ImagePublicId,
  UserPublicId,
} from "@/types/branded";

@injectable()
export class CreateNotificationCommandHandler implements ICommandHandler<
  CreateNotificationCommand,
  INotification
> {
  private readonly MAX_NOTIFICATIONS_PER_USER = 200;

  constructor(
    @inject(TOKENS.Models.WebSocketServer)
    private readonly webSocketServer: WebSocketServer,
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
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

  async execute(command: CreateNotificationCommand): Promise<INotification> {
    const data = command.payload;
    if (!data.receiverId || !data.actionType || !data.actorId) {
      throw Errors.validation("Missing required notification fields");
    }

    try {
      const userPublicId = data.receiverId.trim();
      const actorPublicId = data.actorId.trim();
      const targetPublicId = data.targetId?.trim();
      let actorUsername = data.actorUsername?.trim();
      let actorHandle = data.actorHandle?.trim();
      let actorAvatar = data.actorAvatar?.trim();
      const targetType = data.targetType?.trim();
      const targetPreview = data.targetPreview?.trim();

      if (
        (!actorUsername || !actorHandle || !actorAvatar) &&
        actorPublicId !== SystemActor.id
      ) {
        try {
          const actor = await this.userReadRepository.findByPublicId(
            asUserPublicId(actorPublicId),
          );
          if (actor) {
            actorUsername = actorUsername || actor.username;
            actorHandle = actorHandle || actor.handle;
            actorAvatar = actorAvatar || actor.avatar;
          }
        } catch (err) {
          logger.warn(
            `Failed to fetch fallback actor info for ${actorPublicId}`,
            { error: err },
          );
        }
      }

      if (!actorAvatar) {
        actorAvatar = SystemActor.avatar;
      }

      const notification = await this.notificationRepository.create({
        userId: asUserPublicId(userPublicId),
        actionType: data.actionType,
        actorId: asUserPublicId(actorPublicId),
        actorUsername,
        actorHandle,
        actorAvatar,
        targetId: targetPublicId as unknown as
          | PostPublicId
          | ImagePublicId
          | UserPublicId
          | undefined,
        targetType,
        targetPreview,
        isRead: false,
        timestamp: new Date(),
      });

      try {
        const plain = this.toPlainNotification(notification);
        logger.info(`Sending new_notification to user ${userPublicId}:`, {
          notification: plain,
        });
        this.webSocketServer
          .getIO()
          .to(userPublicId)
          .emit("new_notification", plain);
        logger.info("Notification sent successfully");
      } catch (error) {
        logger.error("Error sending notification:", { error });
      }

      await this.redisService.pushNotification(
        userPublicId,
        notification,
        this.MAX_NOTIFICATIONS_PER_USER,
      );

      return notification as any;
    } catch (error) {
      logger.error(`notificationRepository.create error:`, { error });
      throw wrapError(error, "InternalServerError", {
        context: { operation: "createNotification" },
      });
    }
  }
}
