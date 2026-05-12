import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { EventBus } from "@/application/common/buses/event.bus";
import { logger } from "@/utils/winston";
import { BasePollingWorker } from "@/workers/base/BasePollingWorker";

@injectable()
export class OutboxWorker extends BasePollingWorker {
  constructor(
    @inject(TOKENS.Repositories.Outbox) private readonly outboxRepository: OutboxRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus
  ) {
    super("OutboxWorker", 2000);
  }

  protected async tick(): Promise<void> {
    const limit = 50;
    const events = await this.outboxRepository.getUnprocessedEvents(limit);

    if (events.length === 0) return;

    logger.debug(`[OutboxWorker] Found ${events.length} unprocessed events`);

    for (const record of events) {
      try {
        await this.eventBus.publishByType(record.eventType, record.payload);
        await this.outboxRepository.markAsProcessed(String(record._id));
        logger.debug(`[OutboxWorker] Successfully processed event: ${record.eventType}`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(
          `[OutboxWorker] Failed to process event ${record.eventType}: ${message}`,
        );
        await this.outboxRepository.markAsFailed(String(record._id), message);
      }
    }
  }
}
