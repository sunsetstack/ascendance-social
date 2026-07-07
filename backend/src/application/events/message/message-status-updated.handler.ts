import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { MessageStatusUpdatedEvent } from "@/application/events/message/message.event";
import { RedisService } from "@/services/redis.service";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class MessageStatusUpdatedHandler implements IEventHandler<MessageStatusUpdatedEvent> {
	constructor(@inject(TOKENS.Services.Redis) private readonly redisService: RedisService) {}

	async handle(event: MessageStatusUpdatedEvent): Promise<void> {
		await this.redisService.publish(
			EventRegistry.redisChannels.messagingUpdates,
			JSON.stringify({
				eventId: buildRealtimeEventId(
					EventRegistry.realtimeMessageTypes.messageStatusUpdated,
					event.conversationPublicId,
					event.status,
					event.timestamp.toISOString(),
				),
				type: EventRegistry.realtimeMessageTypes.messageStatusUpdated,
				conversationId: event.conversationPublicId,
				recipients: event.participantPublicIds,
				status: event.status,
				timestamp: event.timestamp.toISOString(),
			}),
		);
	}
}
