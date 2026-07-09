import { inject, injectable } from "tsyringe";
import { Server } from "socket.io";
import { IRealtimeMessageHandler } from "../realtime/IRealtimeMessageHandler.interface";
import { FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { logger } from "@/utils/winston";
import {
  EventRegistry,
  buildRealtimeEventId,
} from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostDeletedMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.postDeleted;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(io: Server, message: FeedUpdateMessage): Promise<void> {
    const postId = message.postId;
    if (!postId) return;

    io.emit(EventRegistry.socketServerEvents.feedUpdate, {
      eventId:
        message.eventId ??
        buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.postDeleted,
          postId,
        ),
      type: EventRegistry.realtimeMessageTypes.postDeleted,
      postId,
      timestamp: message.timestamp,
    });
    this.metricsService.recordSocketEventEmitted(
      EventRegistry.socketServerEvents.feedUpdate,
      "broadcast",
    );

    logger.info(`Real-time notification sent for post deletion ${postId}`);
  }
}
