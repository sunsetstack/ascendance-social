import { randomUUID } from "node:crypto";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";
import {
  MAX_OUTBOX_RETRIES,
  OutboxRepository,
  type OutboxBacklogStats,
} from "@/repositories/outbox.repository";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { logger } from "@/utils/winston";
import { logNonHttpTerminalError } from "@/runtime/non-http-error-logger";
import { BasePollingWorker } from "@/workers/base/BasePollingWorker";
import {
  addRequestContextBreadcrumb,
  attachErrorBreadcrumbSnapshot,
  getRequestContext,
  runWithRequestContext,
} from "@/runtime/request-context";
import { serializeError } from "@/utils/error-serialization";

const OUTBOX_RETRY_JITTER_RATIO = 0.2;

@injectable()
export class OutboxWorker extends BasePollingWorker {
  private readonly workerId = randomUUID();

  constructor(
    @inject(TOKENS.Repositories.Outbox)
    private readonly outboxRepository: OutboxRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {
    super("OutboxWorker", 2000);
  }

  protected async tick(): Promise<void> {
    const limit = 50;
    const configuredClaimMs = Number(
      process.env.OUTBOX_CLAIM_TIMEOUT_MS || "60000",
    );
    const staleClaimMs =
      Number.isSafeInteger(configuredClaimMs) && configuredClaimMs >= 1000
        ? configuredClaimMs
        : 60000;
    const backlog = await this.readBacklogStats();
    const pendingCount = backlog.pendingCount;
    this.metricsService.setOutboxPendingCount(pendingCount);
    this.metricsService.setOutboxBacklogStatus(
      backlog.exhaustedCount,
      backlog.oldestPendingAt,
    );

    if (pendingCount === 0) return;

    let batchSize = 0;
    for (let index = 0; index < limit; index++) {
      const [record] = await this.outboxRepository.claimPendingEvents(
        1,
        this.workerId,
        staleClaimMs,
      );
      if (!record) break;
      batchSize++;
      const attemptStartedAt = Date.now();
      const eventId = String(record._id);
      const traceId = record.traceId || eventId;
      const correlationId = record.correlationId || traceId;
      const processedHandlers = new Set(record.processedHandlers || []);
      const handlers = this.eventBus.getRegisteredHandlers(record.eventType);
      const result = await runWithRequestContext(
        {
          correlationId,
          requestStartTime: process.hrtime.bigint(),
        },
        () => this.withClaimRenewal(eventId, staleClaimMs, async (assertOwnership) => {
          addRequestContextBreadcrumb("worker.outbox.received", {
            eventId,
            eventType: record.eventType,
            retryAttempt: record.retries,
          });
          let handlerInProgress = false;
          try {
            for (const handler of handlers) {
              assertOwnership();
              if (processedHandlers.has(handler.key)) {
                continue;
              }

              addRequestContextBreadcrumb("worker.outbox.handler.enter", {
                eventId,
                handler: handler.key,
              });
              handlerInProgress = true;
              await handler.handle(record.payload);
              handlerInProgress = false;
              assertOwnership();
              const handlerMarked =
                await this.outboxRepository.markHandlerProcessed(
                  eventId,
                  handler.key,
                  this.workerId,
                );
              if (!handlerMarked) {
                throw new Error(
                  "Outbox event ownership lost before handler checkpoint",
                );
              }
              addRequestContextBreadcrumb("worker.outbox.handler.acknowledged", {
                eventId,
                handler: handler.key,
              });
              processedHandlers.add(handler.key);
            }

            assertOwnership();
            const eventMarked = await this.outboxRepository.markAsProcessed(
              eventId,
              this.workerId,
            );
            if (!eventMarked) {
              throw new Error("Outbox event ownership lost before completion");
            }
            addRequestContextBreadcrumb("worker.outbox.acknowledged", { eventId });
            return { processed: true };
          } catch (error) {
            addRequestContextBreadcrumb(
              handlerInProgress
                ? "worker.outbox.handler.failed"
                : "worker.outbox.processing.failed",
              {
              eventId,
              eventType: record.eventType,
              retryAttempt: record.retries,
              },
            );
            const message = serializeError(error).message;
            const retryAttempt = record.retries + 1;
            const exhausted = retryAttempt >= MAX_OUTBOX_RETRIES;
            const failureTime = Date.now();
            const nextAttemptAt = exhausted
              ? undefined
              : new Date(failureTime + this.retryDelayMs(retryAttempt));
            this.metricsService.recordOutboxAttempt(
              record.eventType,
              "failed",
              Date.now() - attemptStartedAt,
            );
            addRequestContextBreadcrumb("worker.outbox.retry.requested", {
              eventId,
              retryAttempt,
              exhausted,
            });
            let failedMarked: boolean;
            try {
              failedMarked = await this.outboxRepository.markAsFailed(
                eventId,
                message,
                this.workerId,
                {
                  nextAttemptAt,
                  exhaustedAt: exhausted
                    ? new Date(failureTime)
                    : undefined,
                },
              );
            } catch (markFailure) {
              throw attachErrorBreadcrumbSnapshot(new AggregateError(
                [error, markFailure],
                "Outbox event failure could not be recorded",
                { cause: error },
              ), getRequestContext()?.breadcrumbs ?? []);
            }
            if (failedMarked) {
              if (exhausted) {
                logger.error("Outbox event exhausted automatic retries", {
                  event: "worker.outbox.event_exhausted",
                  eventId,
                  eventType: record.eventType,
                  retryCount: retryAttempt,
                  ageMs: Math.max(
                    0,
                    failureTime - record.createdAt.getTime(),
                  ),
                  replayGuidance:
                    "Resolve the underlying failure, then run requeue-outbox-event with this event ID.",
                });
              }

              addRequestContextBreadcrumb(
                exhausted
                  ? "worker.outbox.exhausted"
                  : "worker.outbox.retry.scheduled",
                {
                  eventId,
                  retryAttempt,
                  ...(nextAttemptAt
                    ? { nextAttemptAt: nextAttemptAt.toISOString() }
                    : {}),
                },
              );
            }
            logNonHttpTerminalError(error, {
              message: "Outbox event failed",
              event: "outbox.event.failed",
              operation: "worker.outbox.handle_message",
              operationId: correlationId,
              worker: "OutboxWorker",
              messageType: record.eventType,
              messageId: eventId,
              attempt: retryAttempt,
              traceId,
              correlationId,
              durationMs: Date.now() - attemptStartedAt,
              breadcrumbs: getRequestContext()?.breadcrumbs,
            });
            if (!failedMarked) {
              logger.warn("Outbox event failure not recorded because ownership changed", {
                event: "outbox.event.ownership_lost",
                worker: "OutboxWorker",
                eventId,
                eventType: record.eventType,
                traceId,
                correlationId,
              });
            }
            return { processed: false };
          }
        }),
      );
      if (result.processed) {
        this.metricsService.recordOutboxAttempt(
          record.eventType,
          "processed",
          Date.now() - attemptStartedAt,
        );
        logger.info("Outbox event processed", {
          event: "outbox.event.processed",
          worker: "OutboxWorker",
          eventId,
          eventType: record.eventType,
          retries: record.retries,
          traceId,
          correlationId,
          durationMs: Date.now() - attemptStartedAt,
        });
      }
    }

    this.metricsService.recordOutboxBatchSize(batchSize);
    const updatedBacklog = await this.readBacklogStats();
    this.metricsService.setOutboxPendingCount(updatedBacklog.pendingCount);
    this.metricsService.setOutboxBacklogStatus(
      updatedBacklog.exhaustedCount,
      updatedBacklog.oldestPendingAt,
    );
  }

  private async withClaimRenewal<T>(
    eventId: string,
    staleClaimMs: number,
    work: (assertOwnership: () => void) => Promise<T>,
  ): Promise<T> {
    let renewalFailure: Error | undefined;
    let renewal: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (renewal || renewalFailure) return;
      renewal = this.outboxRepository
        .renewClaim(eventId, this.workerId)
        .then((owned) => {
          if (!owned) {
            throw new Error("Outbox event ownership lost during processing");
          }
        })
        .catch((error: unknown) => {
          renewalFailure = error instanceof Error
            ? error
            : new Error("Outbox claim renewal failed", { cause: error });
        })
        .finally(() => {
          renewal = undefined;
        });
    }, Math.floor(staleClaimMs / 3));
    timer.unref();
    try {
      return await work(() => {
        if (renewalFailure) throw renewalFailure;
      });
    } finally {
      clearInterval(timer);
      await renewal;
    }
  }

  private async readBacklogStats(): Promise<OutboxBacklogStats> {
    if (typeof this.outboxRepository.getBacklogStats === "function") {
      return this.outboxRepository.getBacklogStats();
    }

    return {
      pendingCount: await this.outboxRepository.countPendingEvents(),
      exhaustedCount: 0,
    };
  }

  private retryDelayMs(retryAttempt: number): number {
    const parsedBaseDelay = Number.parseInt(
      process.env.OUTBOX_RETRY_BASE_DELAY_MS ?? "15000",
      10,
    );
    const parsedMaxDelay = Number.parseInt(
      process.env.OUTBOX_RETRY_MAX_DELAY_MS ?? "300000",
      10,
    );
    const baseDelay =
      Number.isFinite(parsedBaseDelay) && parsedBaseDelay > 0
        ? parsedBaseDelay
        : 15000;
    const maxDelay =
      Number.isFinite(parsedMaxDelay) && parsedMaxDelay >= baseDelay
        ? parsedMaxDelay
        : 300000;
    const exponentialDelay = Math.min(
      maxDelay,
      baseDelay * 2 ** Math.max(0, retryAttempt - 1),
    );
    const jitterWindow = exponentialDelay * OUTBOX_RETRY_JITTER_RATIO;
    const jitteredDelay =
      exponentialDelay - jitterWindow + Math.random() * jitterWindow * 2;

    return Math.min(maxDelay, Math.max(1, Math.round(jitteredDelay)));
  }
}
