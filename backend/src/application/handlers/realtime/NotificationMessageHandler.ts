import { Server as SocketIOServer } from "socket.io";
import { inject, injectable } from "tsyringe";
import {
  EventRegistry,
  buildRealtimeEventId,
} from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";
import { FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { TOKENS } from "@/types/tokens";
import { logger } from "@/utils/winston";
import { IRealtimeMessageHandler } from "./IRealtimeMessageHandler.interface";

@injectable()
export class NotificationMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.newNotification;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(
    io: SocketIOServer,
    message: FeedUpdateMessage,
    channel?: string,
  ): Promise<void> {
    if (!message.userId || !message.notification) return;

    const notificationId =
      message.notification.id ?? message.notification._id ?? message.eventId;
    const payload = {
      ...message.notification,
      eventId:
        message.eventId ??
        buildRealtimeEventId(
          EventRegistry.socketServerEvents.newNotification,
          notificationId,
        ),
    };

    io.to(message.userId).emit(
      EventRegistry.socketServerEvents.newNotification,
      payload,
    );
    this.metricsService.recordSocketEventEmitted(
      EventRegistry.socketServerEvents.newNotification,
      "room",
    );
    logger.info("Realtime notification delivered", {
      channel: channel ?? EventRegistry.redisChannels.notificationUpdates,
      eventId: payload.eventId,
      userPublicId: message.userId,
    });
  }
}
