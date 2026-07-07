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
export class NewPostMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.newPost;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(io: SocketIOServer, message: FeedUpdateMessage): Promise<void> {
    const authorId = message.authorId ?? message.uploaderId;
    const postId = message.postId ?? message.imageId;
    if (!authorId || !postId) return;

    // TARGETED NOTIFICATIONS: notify specific users about content in their personalized feeds
    if (message.affectedUsers && message.affectedUsers.length > 0) {
      for (const userId of message.affectedUsers) {
        io.to(userId).emit(EventRegistry.socketServerEvents.feedUpdate, {
          eventId:
            message.eventId ??
            buildRealtimeEventId(
              EventRegistry.realtimeMessageTypes.newPost,
              postId,
            ),
          type: EventRegistry.realtimeMessageTypes.newPost,
          authorId,
          postId,
          tags: message.tags,
          timestamp: message.timestamp,
        });
        this.metricsService.recordSocketEventEmitted(
          EventRegistry.socketServerEvents.feedUpdate,
          "room",
        );
      }
    }

    // also notify the uploader
    io.to(authorId).emit(EventRegistry.socketServerEvents.feedUpdate, {
      eventId:
        message.eventId ??
        buildRealtimeEventId(EventRegistry.realtimeMessageTypes.newPost, postId),
      type: EventRegistry.socketPayloadTypes.postPublished,
      postId,
      tags: message.tags,
      timestamp: message.timestamp,
    });
    this.metricsService.recordSocketEventEmitted(
      EventRegistry.socketServerEvents.feedUpdate,
      "room",
    );

    logger.info(
      `Real-time notification sent to ${message.affectedUsers?.length || 0} specific users for new post ${postId}`,
    );
  }
}
