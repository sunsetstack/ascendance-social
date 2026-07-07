import { Server as SocketIOServer } from "socket.io";
import { inject, injectable } from "tsyringe";
import { IRealtimeMessageHandler } from "./IRealtimeMessageHandler.interface";
import { FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { logger } from "@/utils/winston";
import {
  EventRegistry,
  buildRealtimeEventId,
} from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class MessageSentHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.messageSent;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(
    io: SocketIOServer,
    message: FeedUpdateMessage,
    channel?: string,
  ): Promise<void> {
    if (!message.conversationId || !message.senderId) return;

    const recipients = Array.isArray(message.recipients)
      ? message.recipients
      : [];
    const uniqueRecipients = new Set<string>([message.senderId, ...recipients]);
    uniqueRecipients.delete("");

    for (const userId of uniqueRecipients) {
      io.to(userId).emit(EventRegistry.socketServerEvents.messagingUpdate, {
        eventId:
          message.eventId ??
          buildRealtimeEventId(
            EventRegistry.realtimeMessageTypes.messageSent,
            message.messageId,
          ),
        type: EventRegistry.realtimeMessageTypes.messageSent,
        conversationId: message.conversationId,
        messageId: message.messageId,
        senderId: message.senderId,
        timestamp: message.timestamp,
      });
      this.metricsService.recordSocketEventEmitted(
        EventRegistry.socketServerEvents.messagingUpdate,
        "room",
      );
    }

    logger.info(
      `Real-time messaging update sent via ${channel || EventRegistry.redisChannels.messagingUpdates} for conversation ${message.conversationId}`,
    );
  }
}
