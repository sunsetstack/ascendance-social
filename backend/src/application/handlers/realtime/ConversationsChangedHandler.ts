import { Server } from "socket.io";
import { inject, injectable } from "tsyringe";
import { IRealtimeMessageHandler } from "./IRealtimeMessageHandler.interface";
import { FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { EventRegistry } from "@/application/common/events/event-registry";
import { emitToAuthenticatedUser } from "@/server/socket-security";
import { MetricsService } from "@/metrics/metrics.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ConversationsChangedHandler implements IRealtimeMessageHandler {
  readonly messageType =
    EventRegistry.realtimeMessageTypes.conversationsChanged;

  constructor(@inject(TOKENS.Services.Metrics) private readonly metrics: MetricsService) {}

  async handle(io: Server, message: FeedUpdateMessage): Promise<void> {
    for (const userId of new Set(message.recipients ?? [])) {
      await emitToAuthenticatedUser(
        io,
        userId,
        EventRegistry.socketServerEvents.messagingUpdate,
        {
          type: this.messageType,
          eventId: message.eventId,
          timestamp: message.timestamp,
        },
      );
      this.metrics.recordSocketEventEmitted(EventRegistry.socketServerEvents.messagingUpdate, "room");
    }
  }
}
