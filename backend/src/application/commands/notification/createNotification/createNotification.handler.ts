import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { CreateNotificationCommand } from "./createNotification.command";
import { NotificationRepository } from "@/repositories/notification.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { RedisService } from "@/services/redis.service";
import { INotification } from "@/types";
import { Errors, wrapError } from "@/utils/errors";
import { requireNotificationRecord } from "@/utils/notification-plain";
import { SystemActor } from "@/utils/actors/SystemActor";
import { logger } from "@/utils/winston";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { UnitOfWork } from "@/database/UnitOfWork";
import {
  EventRegistry,
  buildRealtimeEventId,
} from "@/application/common/events/event-registry";
import {
  asUserPublicId,
  PostPublicId,
  ImagePublicId,
  UserPublicId,
} from "@/types/branded";

@injectable()
export class CreateNotificationCommandHandler implements ICommandHandler<
  CreateNotificationCommand,
  INotification | null
> {
  constructor(
    @inject(TOKENS.Repositories.Notification)
    private readonly notificationRepository: NotificationRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
  ) {}

  async execute(command: CreateNotificationCommand): Promise<INotification | null> {
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
      const idempotencyKey = data.idempotencyKey?.trim();

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

      const notificationData: Partial<INotification> = {
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
      };

      const persist = (): Promise<INotification> => idempotencyKey
        ? this.notificationRepository.createOnce(
            notificationData,
            idempotencyKey,
          )
        : this.notificationRepository.create(notificationData);

      // Comment replies use the containing post as their navigation target.
      const guardedTargetType = targetType === "comment" && data.actionType === "comment_reply"
        ? "post"
        : targetType;
      const notification = guardedTargetType === "post" || guardedTargetType === "comment"
        ? await this.unitOfWork.executeInTransaction(async () => {
            if (!(await this.notificationRepository.guardContentTarget(guardedTargetType, targetPublicId))) {
              return null;
            }
            return persist();
          })
        : await persist();

      if (!notification) return null;
      const plain = requireNotificationRecord(notification);
      await this.redisService.clearNotificationCaches([userPublicId]);

      const eventId = buildRealtimeEventId(
        EventRegistry.socketServerEvents.newNotification,
        plain.id,
      );
      await this.redisService.publish(
        EventRegistry.redisChannels.notificationUpdates,
        {
          type: EventRegistry.realtimeMessageTypes.newNotification,
          eventId,
          userId: userPublicId,
          notification: plain,
          timestamp: new Date().toISOString(),
        },
      );
      logger.info("Notification queued for realtime delivery", {
        eventId,
        userPublicId,
      });

      return notification;
    } catch (error) {
      throw wrapError(error, "InternalServerError", {
        context: { operation: "createNotification" },
      });
    }
  }
}
