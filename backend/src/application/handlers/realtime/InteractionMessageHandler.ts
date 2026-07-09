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
export class InteractionMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.interaction;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(io: SocketIOServer, message: FeedUpdateMessage): Promise<void> {
    if (!message.userId || !message.targetId) return;

    // notify the content owner about the interaction
    // this would require looking up the owner of the target content

    io.emit(EventRegistry.socketServerEvents.feedInteraction, {
      eventId:
        message.eventId ??
        buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.interaction,
          message.actionType,
          message.userId,
          message.targetId,
          message.timestamp,
        ),
      type: EventRegistry.socketPayloadTypes.userInteraction,
      userId: message.userId,
      actionType: message.actionType,
      targetId: message.targetId,
      tags: message.tags,
      timestamp: message.timestamp,
    });
    this.metricsService.recordSocketEventEmitted(
      EventRegistry.socketServerEvents.feedInteraction,
      "broadcast",
    );

    logger.info(
      `Real-time interaction notification sent for ${message.actionType} on ${message.targetId}`,
    );
  }
}
