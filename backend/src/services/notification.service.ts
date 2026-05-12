import { NotificationRepository } from "@/repositories/notification.repository";
import { INotification, NotificationPlain } from "@/types";
import { Errors, isErrorWithStatusCode, wrapError } from "@/utils/errors";
import { inject, injectable } from "tsyringe";
import { Server as SocketIOServer } from "socket.io";
import { WebSocketServer } from "../server/socketServer";
import { UserRepository } from "@/repositories/user.repository";
import { ImageRepository } from "@/repositories/image.repository";
import { RedisService } from "./redis.service";
import { redisLogger, errorLogger, logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { SystemActor } from "@/utils/actors/SystemActor";
import { normalizeNotificationPlain } from "@/utils/notification-plain";

@injectable()
export class NotificationService {
  // cache TTL: 30 days for notification hashes
  private readonly NOTIFICATION_CACHE_TTL = 2592000;
  private readonly MAX_NOTIFICATIONS_PER_USER = 200;

  constructor(
    @inject(TOKENS.Models.WebSocketServer) private webSocketServer: WebSocketServer,
    @inject(TOKENS.Repositories.Notification)
    private notificationRepository: NotificationRepository,
    @inject(TOKENS.Repositories.User) private userRepository: UserRepository,
    @inject(TOKENS.Repositories.Image) private imageRepository: ImageRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
  ) {}

  private getIO(): SocketIOServer {
    return this.webSocketServer.getIO();
  }

  private toPlainNotification(notification: INotification | NotificationPlain): NotificationPlain {
    const raw =
      typeof notification === "object" &&
      notification !== null &&
      "toJSON" in notification &&
      typeof notification.toJSON === "function"
        ? notification.toJSON()
        : notification;

    return normalizeNotificationPlain(raw) ?? {};
  }

  private sendNotification(
    io: SocketIOServer,
    userPublicId: string,
    notification: INotification | NotificationPlain,
  ) {
    try {
      const plain = this.toPlainNotification(notification);

      logger.info(`Sending new_notification to user ${userPublicId}:`, {
        notification: plain,
      });
      io.to(userPublicId).emit("new_notification", plain);
      logger.info("Notification sent successfully");
    } catch (error) {
      logger.error("Error sending notification:", { error });
      throw wrapError(error);
    }
  }

  private readNotification(
    io: SocketIOServer,
    userPublicId: string,
    notification: INotification | NotificationPlain,
  ) {
    try {
      const plain = this.toPlainNotification(notification);

      logger.info(`Sending notification_read to user ${userPublicId}:`, {
        notification: plain,
      });
      io.to(userPublicId).emit("notification_read", plain);
      logger.info("Notification read event sent successfully");
    } catch (error) {
      logger.error("Error sending notification read event:", { error });
      throw wrapError(error);
    }
  }

  async createNotification(data: {
    receiverId: string; // user publicId
    actionType: string; // like, comment, follow, etc
    actorId: string; // actor publicId
    targetId?: string; // optional target publicId (e.g., post publicId)
    targetType?: string; // 'post' | 'image' | 'user'
    targetPreview?: string; // preview text/snippet
    actorUsername?: string; // optional actor username provided by frontend
    actorHandle?: string; // optional actor handle provided by frontend
    actorAvatar?: string; // optional actor avatar URL
  }): Promise<INotification> {
    if (!data.receiverId || !data.actionType || !data.actorId) {
      throw Errors.validation(
        "Missing required notification fields",
      );
    }

    try {
      //trust publicIds from frontend
      const userPublicId = data.receiverId.trim();
      const actorPublicId = data.actorId.trim();
      const targetPublicId = data.targetId?.trim();
      let actorUsername = data.actorUsername?.trim();
      let actorHandle = data.actorHandle?.trim();
      let actorAvatar = data.actorAvatar?.trim();
      const targetType = data.targetType?.trim();
      const targetPreview = data.targetPreview?.trim();

      // Fallback: Fetch actor info if missing
      if (
        (!actorUsername || !actorHandle || !actorAvatar) &&
        actorPublicId !== SystemActor.id
      ) {
        try {
          const actor = await this.userRepository.findByPublicId(actorPublicId);
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

      // Final fallback for avatar to ensure it's never empty
      if (!actorAvatar) {
        actorAvatar = SystemActor.avatar;
      }

      const io = this.getIO();

      const notification = await this.notificationRepository.create(
        {
          userId: userPublicId,
          actionType: data.actionType,
          actorId: actorPublicId,
          actorUsername,
          actorHandle,
          actorAvatar,
          targetId: targetPublicId,
          targetType,
          targetPreview,
          isRead: false,
          timestamp: new Date(),
        },
      );

      // emit via WebSocket
      this.sendNotification(io, userPublicId, notification);

      // push to Redis List+Hash using new pattern
      await this.redisService.pushNotification(
        userPublicId,
        notification,
        this.MAX_NOTIFICATIONS_PER_USER,
      );

      return notification;
    } catch (error) {
      logger.error(`notificationRepository.create error:`, { error });
      throw Errors.internal("Failed to create notification");
    }
  }

  /**
   * Get notifications for a user (using Redis List+Hash pattern)
   * Supports cursor-based pagination with timestamps
   *
   * @param userId - user publicId
   * @param limit - number of notifications to fetch (default: 20)
   * @param before - timestamp cursor for pagination (fetch notifications older than this)
   */
  async getNotifications(
    userId: string,
    limit: number = 20,
    before?: number,
  ): Promise<NotificationPlain[]> {
    redisLogger.debug(`getNotifications called`, { userId, before, limit });

    try {
      // if cursor-based pagination (before timestamp), skip Redis and go to MongoDB
      if (before) {
        redisLogger.info(`Cursor-based pagination, fetching from DB`, {
          userId,
          before,
        });
        const beforeDate = new Date(before);
        const dbNotifications =
          await this.notificationRepository.getNotificationsBeforeTimestamp(
            userId,
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

      // initial page load - try Redis cache first
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

      // cache miss - fetch from MongoDB
      redisLogger.info(`Notification Redis MISS, fetching from DB`, { userId });
      // Fetch up to MAX_NOTIFICATIONS_PER_USER to properly populate the Redis cache,
      // but only return `limit` items to the caller
      const allRecentNotifications =
        await this.notificationRepository.getNotifications(
          userId,
          this.MAX_NOTIFICATIONS_PER_USER,
          0,
        );

      redisLogger.debug(`DB returned notifications for backfill`, {
        userId,
        count: allRecentNotifications.length,
      });

      // backfill cache with the full recent window
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
      if (error instanceof Error) {
        throw Errors.internal(error.message);
      } else {
        throw Errors.internal(String(error));
      }
    }
  }

  async markAsRead(notificationId: string, userPublicId: string) {
    try {
      logger.info(`[NotificationService] markAsRead requested`, {
        notificationId,
        userPublicId,
      });
      const io = this.getIO();
      const updatedNotification = await this.notificationRepository.markAsRead(
        notificationId,
        userPublicId,
      );
      if (!updatedNotification) {
        logger.info(`[NotificationService] markAsRead not found`, {
          notificationId,
          userPublicId,
        });
        throw Errors.notFound("Notification");
      }
      logger.info(`[NotificationService] markAsRead updated`, {
        notificationId,
        userPublicId,
      });
      this.readNotification(io, userPublicId, updatedNotification);

      // update in Redis hash (O(1) operation)
      await this.redisService.markNotificationRead(notificationId);

      return updatedNotification;
    } catch (error) {
      // if already an AppError with statuscode then rethrow
      if (isErrorWithStatusCode(error)) throw error;
      throw wrapError(error);
    }
  }

  /**
   * Get unread notification count for a user using Redis
   */
  async getUnreadCount(userPublicId: string): Promise<number> {
    try {
      return await this.redisService.getUnreadNotificationCount(userPublicId);
    } catch (error) {
      // fallback to DB on error
      logger.warn(
        `[NotificationService] Redis error getting unread count, falling back to DB:`,
        { error },
      );
      return await this.notificationRepository.getUnreadCount(userPublicId);
    }
  }

  async markAllAsRead(userPublicId: string): Promise<number> {
    try {
      const modifiedCount =
        await this.notificationRepository.markAllAsRead(userPublicId);

      if (modifiedCount > 0) {
        const notificationIds =
          await this.redisService.getUserNotificationIds(userPublicId);
        if (notificationIds.length > 0) {
          await this.redisService.markNotificationsRead(notificationIds);
        }

        // emit WebSocket event
        const io = this.getIO();
        io.to(userPublicId).emit("all_notifications_read");
      }

      return modifiedCount;
    } catch (error) {
      if (error instanceof Error) {
        throw Errors.internal(error.message);
      }
      throw Errors.internal(String(error));
    }
  }
}
