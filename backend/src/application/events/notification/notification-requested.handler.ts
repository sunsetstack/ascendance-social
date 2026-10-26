import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import type { IUserReadRepository } from "@/repositories/interfaces";
import {
  asConversationPublicId,
  asUserPublicId,
} from "@/types/branded";
import { SystemActor } from "@/utils/actors/SystemActor";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { getConversationClearedAt } from "@/application/messaging/messaging-support";
import { getParticipantIds } from "@/utils/messaging-helpers";
import { isUserViewingConversation } from "@/server/socketServer";

@injectable()
export class NotificationRequestedHandler implements IEventHandler<NotificationRequestedEvent> {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus)
    private readonly commandBus: CommandBus,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.Message)
    private readonly messageRepository: MessageRepository,
  ) {}

  private async isMessageNotificationEligible(
    event: NotificationRequestedEvent,
    receiverInternalId: string,
  ): Promise<boolean> {
    if (event.payload.actionType !== "message") {
      return true;
    }

    const conversationPublicId = event.payload.targetId;
    const messagePublicId = event.payload.messagePublicId;
    if (
      event.payload.targetType !== "conversation" ||
      !conversationPublicId ||
      !messagePublicId
    ) {
      return false;
    }

    const conversation = await this.conversationRepository.findByPublicId(
      asConversationPublicId(conversationPublicId),
    );
    if (!conversation) {
      return false;
    }

    const message = await this.messageRepository.findByPublicId(
      messagePublicId,
    );
    if (
      !message ||
      message.conversation.toString() !== conversation._id.toString()
    ) {
      return false;
    }

    const clearedAt = getConversationClearedAt(
      conversation,
      receiverInternalId,
    );
    if (
      !getParticipantIds(conversation.participants).includes(
        receiverInternalId,
      ) ||
      conversation.hiddenFor?.some(
        (id) => id.toString() === receiverInternalId,
      ) ||
      (clearedAt && message.createdAt <= clearedAt)
    ) {
      return false;
    }

    return !(await isUserViewingConversation(
      event.payload.receiverId,
      conversationPublicId,
    ));
  }

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

      if (!(await this.isMessageNotificationEligible(event, receiver.id))) {
        logger.info(
          "[NotificationRequestedHandler] Skipping stale or suppressed message notification",
          {
            receiverId: event.payload.receiverId,
            targetId: event.payload.targetId,
            messagePublicId: event.payload.messagePublicId,
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
