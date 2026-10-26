import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { RedisService } from "@/services/redis.service";
import { EventBus } from "@/application/common/buses/event.bus";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";
import type { IUserReadRepository } from "@/repositories/interfaces";
import type { UserPublicId } from "@/types/branded";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { UnitOfWork } from "@/database/UnitOfWork";
import { getConversationClearedAt } from "@/application/messaging/messaging-support";

@injectable()
export class MessageSentHandler implements IEventHandler<MessageSentEvent> {
	constructor(
		@inject(TOKENS.Repositories.Conversation) private readonly conversations: ConversationRepository,
		@inject(TOKENS.Repositories.Message) private readonly messages: MessageRepository,
		@inject(TOKENS.Repositories.UnitOfWork) private readonly unitOfWork: UnitOfWork,
		@inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
		@inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
		@inject(TOKENS.Repositories.UserRead)
		private readonly userReadRepository: IUserReadRepository,
	) {}

	async handle(event: MessageSentEvent): Promise<void> {
		const activeRecipientIds = await this.unitOfWork.executeInTransaction(
			async (): Promise<UserPublicId[]> => {
				const existing = await this.conversations.findByPublicId(
					event.conversationPublicId,
				);
				if (!existing) return [];
				const conversation = await this.conversations.acquireForMutation(
					event.conversationPublicId,
				);
				const message = await this.messages.findByPublicId(
					event.messagePublicId,
				);
				if (!message) return [];
				const sender = await this.userReadRepository.findByPublicId(
					event.senderPublicId,
				);
				if (!sender || sender.isBanned) {
					return [];
				}

				const activeRecipientIds: UserPublicId[] = [];
				for (const recipientId of event.recipientPublicIds) {
					const user = await this.userReadRepository.findByPublicId(recipientId);
					if (!user || user.isBanned) continue;
					const clearedAt = getConversationClearedAt(conversation, user.id);
					if (
						conversation.hiddenFor?.some(
							(id) => id.toString() === user.id,
						) ||
						(clearedAt && message.createdAt <= clearedAt)
					) {
						continue;
					}
					activeRecipientIds.push(recipientId);
				}
				if (activeRecipientIds.length === 0) {
					return [];
				}

				for (const recipientId of activeRecipientIds) {
					await this.eventBus.queueTransactional(
						new NotificationRequestedEvent({
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
							messagePublicId: event.messagePublicId,
						}),
					);
				}

				return activeRecipientIds;
			},
		);

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
	}
}
