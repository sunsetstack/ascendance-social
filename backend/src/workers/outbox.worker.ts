import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { logger } from "@/utils/winston";
import { BasePollingWorker } from "@/workers/base/BasePollingWorker";

@injectable()
export class OutboxWorker extends BasePollingWorker {
  constructor(
    @inject(TOKENS.Repositories.Outbox) private readonly outboxRepository: OutboxRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {
    super("OutboxWorker", 2000);
  }

  protected async tick(): Promise<void> {
    const limit = 50;
    const pendingCount = await this.outboxRepository.countPendingEvents();
    this.metricsService.setOutboxPendingCount(pendingCount);

    if (pendingCount === 0) return;

    const events = await this.outboxRepository.getUnprocessedEvents(limit);

    if (events.length === 0) return;

    this.metricsService.recordOutboxBatchSize(events.length);
    logger.debug(`[OutboxWorker] Found ${events.length} unprocessed events`, {
      pendingCount,
    });

    for (const record of events) {
      const attemptStartedAt = Date.now();
      const eventId = String(record._id);
      const traceId = record.traceId || eventId;

      try {
        await this.eventBus.publishByType(record.eventType, record.payload);
        await this.outboxRepository.markAsProcessed(eventId);
        this.metricsService.recordOutboxAttempt(
          record.eventType,
          "processed",
          Date.now() - attemptStartedAt,
        );
        logger.debug("[OutboxWorker] Successfully processed event", {
          eventId,
          eventType: record.eventType,
          retries: record.retries,
          traceId,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.metricsService.recordOutboxAttempt(
          record.eventType,
          "failed",
          Date.now() - attemptStartedAt,
        );
        logger.error("[OutboxWorker] Failed to process event", {
          error: message,
          eventId,
          eventType: record.eventType,
          retries: record.retries,
          traceId,
        });
        await this.outboxRepository.markAsFailed(eventId, message);
      }
    }

    this.metricsService.setOutboxPendingCount(
      await this.outboxRepository.countPendingEvents(),
    );
  }
}
