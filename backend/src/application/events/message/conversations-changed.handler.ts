import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { ConversationsChangedEvent } from "./message.event";
import { RedisService } from "@/services/redis.service";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { MetricsService } from "@/metrics/metrics.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import {
  EventRegistry,
  buildRealtimeEventId,
} from "@/application/common/events/event-registry";

@injectable()
export class ConversationsChangedHandler implements IEventHandler<ConversationsChangedEvent> {
  constructor(
    @inject(TOKENS.Repositories.RequestLog)
    private readonly requestLogs: RequestLogRepository,
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Services.Metrics) private readonly metrics: MetricsService,
  ) {}

  async handle(event: ConversationsChangedEvent): Promise<void> {
    try {
      await this.requestLogs.deleteByIds(event.requestLogIds ?? []);
      await this.redis.clearNotificationCaches(
        event.participantPublicIds,
        event.notificationIds,
      );
      await this.redis.publish(EventRegistry.redisChannels.messagingUpdates, {
        type: EventRegistry.realtimeMessageTypes.conversationsChanged,
        eventId: buildRealtimeEventId("conversations_changed", event.eventId),
        recipients: event.participantPublicIds,
        timestamp: event.timestamp.toISOString(),
      });
      this.metrics.recordConversationCleanup("succeeded");
      logger.info("Conversation cleanup and invalidation published", {
        event: "messaging.conversation.cleanup.completed",
        eventId: event.eventId,
        notificationCount: event.notificationIds.length,
        requestLogCount: event.requestLogIds?.length ?? 0,
      });
    } catch (error) {
      this.metrics.recordConversationCleanup("failed");
      logger.error("Conversation cleanup requires retry", {
        event: "messaging.conversation.cleanup.failed",
        eventId: event.eventId,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      throw error;
    }
  }
}
