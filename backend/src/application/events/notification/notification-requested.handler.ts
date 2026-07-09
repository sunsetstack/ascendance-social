import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class NotificationRequestedHandler implements IEventHandler<NotificationRequestedEvent> {
  constructor(@inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus) {}

  async handle(event: NotificationRequestedEvent): Promise<void> {
    try {
      await this.commandBus.dispatch(
        new CreateNotificationCommand({
          receiverId: event.payload.receiverId,
          actionType: event.payload.actionType,
          actorId: event.payload.actorId,
          actorUsername: event.payload.actorUsername,
          actorHandle: event.payload.actorHandle,
          actorAvatar: event.payload.actorAvatar,
          targetId: event.payload.targetId,
          targetType: event.payload.targetType,
          targetPreview: event.payload.targetPreview,
          idempotencyKey: event.payload.idempotencyKey,
        })
      );
    } catch (error) {
      logger.error("[NotificationRequestedHandler] Failed to create notification", { error });
      throw error;
    }
  }
}
