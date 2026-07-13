import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { RedisService } from "@/services/redis.service";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";
import { isUserViewingConversation } from "@/server/socketServer";
import type { IUserReadRepository } from "@/repositories/interfaces";

@injectable()
export class MessageSentHandler implements IEventHandler<MessageSentEvent> {
	constructor(
		@inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
		@inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
		@inject(TOKENS.Repositories.UserRead)
		private readonly userReadRepository: IUserReadRepository,
	) {}

	async handle(event: MessageSentEvent): Promise<void> {
		const sender = await this.userReadRepository.findByPublicId(
			event.senderPublicId,
		);
		if (!sender || sender.isBanned) {
			return;
		}

		const recipientStates = await Promise.all(
			event.recipientPublicIds.map(async (recipientId) => ({
				recipientId,
				user: await this.userReadRepository.findByPublicId(recipientId),
			})),
		);
		const activeRecipientIds = recipientStates
			.filter(({ user }) => Boolean(user && !user.isBanned))
			.map(({ recipientId }) => recipientId);
		if (activeRecipientIds.length === 0) {
			return;
		}

		await this.redisService.publish(
			EventRegistry.redisChannels.messagingUpdates,
			JSON.stringify({
				eventId: buildRealtimeEventId(
					EventRegistry.realtimeMessageTypes.messageSent,
					event.messagePublicId,
				),
				type: EventRegistry.realtimeMessageTypes.messageSent,
				conversationId: event.conversationPublicId,
				senderId: event.senderPublicId,
				recipients: activeRecipientIds,
				messageId: event.messagePublicId,
				timestamp: event.timestamp.toISOString(),
			}),
		);

		for (const recipientId of activeRecipientIds) {
			const isViewingConversation = await isUserViewingConversation(
				recipientId,
				event.conversationPublicId,
			);
			if (isViewingConversation) {
				continue;
			}

			await this.commandBus.dispatch(
				new CreateNotificationCommand({
					receiverId: recipientId,
					actionType: "message",
					actorId: event.senderPublicId,
					actorUsername: event.notification?.actorUsername,
					actorHandle: event.notification?.actorHandle,
					actorAvatar: event.notification?.actorAvatar,
					targetId: event.conversationPublicId,
					targetType: "conversation",
					targetPreview: event.notification?.targetPreview,
					idempotencyKey: `message:${event.messagePublicId}:${recipientId}`,
				}),
			);
		}
	}
}
