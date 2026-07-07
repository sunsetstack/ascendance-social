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
export class LikeUpdateMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.likeUpdate;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(io: SocketIOServer, message: FeedUpdateMessage): Promise<void> {
    const targetId = message.postId ?? message.imageId;
    if (!targetId || message.newLikes === undefined) return;

    // broadcast like count update to all connected users
    io.emit(EventRegistry.socketServerEvents.likeUpdate, {
      eventId:
        message.eventId ??
        buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.likeUpdate,
          targetId,
          message.newLikes,
        ),
      type: EventRegistry.socketPayloadTypes.likeCountChanged,
      postId: targetId,
      imageId: targetId,
      newLikes: message.newLikes,
      timestamp: message.timestamp,
    });
    this.metricsService.recordSocketEventEmitted(
      EventRegistry.socketServerEvents.likeUpdate,
      "broadcast",
    );

    logger.info(
      `Real-time like update sent for post ${targetId}: ${message.newLikes} likes`,
    );
  }
}
