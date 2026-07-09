import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { RedisService } from "@/services/redis.service";
import { CommandBus } from "@/application/common/buses/command.bus";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";
import { isUserViewingConversation } from "@/server/socketServer";

@injectable()
export class MessageSentHandler implements IEventHandler<MessageSentEvent> {
	constructor(
		@inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
		@inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
	) {}

	async handle(event: MessageSentEvent): Promise<void> {
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
				recipients: event.recipientPublicIds,
				messageId: event.messagePublicId,
				timestamp: event.timestamp.toISOString(),
			}),
		);

		for (const recipientId of event.recipientPublicIds) {
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
