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
export class AvatarUpdateMessageHandler implements IRealtimeMessageHandler {
  readonly messageType = EventRegistry.realtimeMessageTypes.avatarChanged;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {}

  async handle(io: SocketIOServer, message: FeedUpdateMessage): Promise<void> {
    if (!message.userId) return;

    // notify all users about avatar change (since avatars appear in feeds)
    io.emit(EventRegistry.socketServerEvents.avatarUpdate, {
      eventId:
        message.eventId ??
        buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.avatarChanged,
          message.userId,
          message.timestamp,
        ),
      type: EventRegistry.socketPayloadTypes.userAvatarChanged,
      userId: message.userId,
      oldAvatar: message.oldAvatar,
      newAvatar: message.newAvatar,
      timestamp: message.timestamp,
    });
    this.metricsService.recordSocketEventEmitted(
      EventRegistry.socketServerEvents.avatarUpdate,
      "broadcast",
    );

    logger.info(`Real-time avatar update sent for user ${message.userId}`);
  }
}
