import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { MessageSentEvent } from "@/application/events/message/message.event";
import { RedisService } from "@/services/redis.service";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class MessageSentHandler implements IEventHandler<MessageSentEvent> {
	constructor(@inject(TOKENS.Services.Redis) private readonly redisService: RedisService) {}

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
	}
}
