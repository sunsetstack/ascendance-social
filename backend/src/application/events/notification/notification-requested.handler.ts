import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { asUserPublicId } from "@/types/branded";
import { SystemActor } from "@/utils/actors/SystemActor";

@injectable()
export class NotificationRequestedHandler implements IEventHandler<NotificationRequestedEvent> {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus)
    private readonly commandBus: CommandBus,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
  ) {}

  async handle(event: NotificationRequestedEvent): Promise<void> {
    try {
      const receiver = await this.userReadRepository.findByPublicId(
        asUserPublicId(event.payload.receiverId),
      );
      const actor =
        event.payload.actorId === SystemActor.id
          ? null
          : await this.userReadRepository.findByPublicId(
              asUserPublicId(event.payload.actorId),
            );
      if (
        !receiver ||
        receiver.isBanned ||
        (event.payload.actorId !== SystemActor.id &&
          (!actor || actor.isBanned))
      ) {
        logger.info(
          "[NotificationRequestedHandler] Skipping stale notification for an unavailable account",
          {
            receiverId: event.payload.receiverId,
            actorId: event.payload.actorId,
          },
        );
        return;
      }

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
