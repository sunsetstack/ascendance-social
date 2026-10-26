import { injectable } from "tsyringe";
import client from "prom-client";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { TransactionObservabilityMetrics } from "@/database/transaction-metrics";

/**
 * manages prometheus metrics for the backend including http requests,
 *  worker status, and external service health
 */
@injectable()
export class MetricsService {
  private readonly registry: client.Registry;
  private readonly httpDuration: client.Histogram<string>;
  private readonly httpRequestsTotal: client.Counter<string>;
  private readonly workerStatus: client.Gauge<string>;
  private readonly workerRestarts: client.Counter<string>;
  private readonly redisUp: client.Gauge<string>;
  private readonly optionalAuthFailuresTotal: client.Counter<string>;
  private readonly domainEventsPublishedTotal: client.Counter<string>;
  private readonly domainEventsStagedTotal: client.Counter<string>;
  private readonly domainEventDispatchFailures: client.Counter<string>;
  private readonly outboxDeliveryIssues: client.Counter<string>;
  private readonly outboxLastPollCompleted: client.Gauge<string>;
  private readonly realtimeEventsPublishedTotal: client.Counter<string>;
  private readonly socketEventsEmittedTotal: client.Counter<string>;
  private readonly outboxPendingEvents: client.Gauge<string>;
  private readonly outboxExhaustedEvents: client.Gauge<string>;
  private readonly outboxOldestPendingAgeSeconds: client.Gauge<string>;
  private readonly outboxEventsTotal: client.Counter<string>;
  private readonly outboxBatchSize: client.Histogram<string>;
  private readonly outboxEventDuration: client.Histogram<string>;
  private readonly feedCursorSnapshotAccesses: client.Counter<string>;
  private readonly feedCursorSnapshotCreations: client.Counter<string>;
  private readonly feedCursorSnapshotBuildCollisions: client.Counter<string>;
  private readonly feedCursorSnapshotBytes: client.Histogram<string>;
  private readonly feedCursorSnapshotBuildDuration: client.Histogram<string>;
  private readonly conversationActions: client.Counter<string>;
  private readonly conversationActionDuration: client.Histogram<string>;
  private readonly conversationCleanupAttempts: client.Counter<string>;

  constructor() {
    this.registry = new client.Registry();
    this.registry.setDefaultLabels({
      service: process.env.SERVICE_NAME ?? "backend",
    });
    // prom-client starts an interval timer for default metrics collection
    // which keeps the event loop alive and can make Mocha hang at the end of the suite
    if (process.env.NODE_ENV !== "test") {
      client.collectDefaultMetrics({
        register: this.registry,
        eventLoopMonitoringPrecision: 10,
      });
    }

    this.httpDuration = new client.Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request latency",
      labelNames: ["method", "route", "status"],
      buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpRequestsTotal = new client.Counter({
      name: "http_requests_total",
      help: "Total HTTP requests",
      labelNames: ["method", "route", "status"],
      registers: [this.registry],
    });

    this.workerStatus = new client.Gauge({
      name: "worker_thread_status",
      help: "Worker thread state (1 running, 0 stopped)",
      labelNames: ["worker"],
      registers: [this.registry],
    });

    this.workerRestarts = new client.Counter({
      name: "worker_thread_restarts_total",
      help: "Worker thread restart count",
      labelNames: ["worker"],
      registers: [this.registry],
    });

    this.redisUp = new client.Gauge({
      name: "redis_connection_up",
      help: "Redis connection state (1 up, 0 down)",
      registers: [this.registry],
    });

    this.optionalAuthFailuresTotal = new client.Counter({
      name: "auth_optional_failures_total",
      help: "Optional-auth failures by reason and route",
      labelNames: ["reason", "route"],
      registers: [this.registry],
    });

    this.domainEventsPublishedTotal = new client.Counter({
      name: "domain_events_published_total",
      help: "Successful immediate dispatches or acknowledged nontransactional outbox writes; not end-to-end delivery",
      labelNames: ["event_type", "mode"],
      registers: [this.registry],
    });

    this.domainEventsStagedTotal = new client.Counter({
      name: "domain_events_staged_total",
      help: "Transactional outbox writes before commit, including rolled back and retried attempts",
      labelNames: ["event_type"], registers: [this.registry],
    });
    this.domainEventDispatchFailures = new client.Counter({
      name: "domain_event_dispatch_failures_total",
      help: "Immediate event dispatch failures and events with no registered handlers",
      labelNames: ["event_type", "reason"], registers: [this.registry],
    });
    this.outboxDeliveryIssues = new client.Counter({
      name: "outbox_delivery_issues_total",
      help: "Outbox routing, ownership and failure-persistence issues",
      labelNames: ["event_type", "reason"], registers: [this.registry],
    });
    this.outboxLastPollCompleted = new client.Gauge({
      name: "outbox_last_poll_completed_timestamp_seconds",
      help: "Last successfully completed outbox poll, including empty polls",
      registers: [this.registry],
    });

    this.realtimeEventsPublishedTotal = new client.Counter({
      name: "realtime_events_published_total",
      help: "Realtime messages published to internal channels",
      labelNames: ["channel", "status"],
      registers: [this.registry],
    });

    this.socketEventsEmittedTotal = new client.Counter({
      name: "socket_events_emitted_total",
      help: "Socket.IO events emitted to clients",
      labelNames: ["event_name", "target"],
      registers: [this.registry],
    });

    this.outboxPendingEvents = new client.Gauge({
      name: "outbox_pending_events",
      help: "Outbox events waiting to be dispatched",
      registers: [this.registry],
    });

    this.outboxExhaustedEvents = new client.Gauge({
      name: "outbox_exhausted_events",
      help: "Outbox events that exhausted automatic retries",
      registers: [this.registry],
    });

    this.outboxOldestPendingAgeSeconds = new client.Gauge({
      name: "outbox_oldest_pending_age_seconds",
      help: "Age in seconds of the oldest retryable outbox event",
      registers: [this.registry],
    });

    this.outboxEventsTotal = new client.Counter({
      name: "outbox_events_total",
      help: "Outbox event processing attempts grouped by event type and outcome",
      labelNames: ["event_type", "status"],
      registers: [this.registry],
    });

    this.outboxBatchSize = new client.Histogram({
      name: "outbox_batch_size",
      help: "Number of outbox records fetched per worker tick",
      buckets: [0, 1, 5, 10, 25, 50, 100],
      registers: [this.registry],
    });

    this.outboxEventDuration = new client.Histogram({
      name: "outbox_event_processing_duration_seconds",
      help: "Outbox event processing duration by event type and outcome",
      labelNames: ["event_type", "status"],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.feedCursorSnapshotAccesses = new client.Counter({
      name: "feed_cursor_snapshot_accesses_total",
      help: "Feed cursor snapshot reads grouped by cache result",
      labelNames: ["result"],
      registers: [this.registry],
    });

    this.feedCursorSnapshotCreations = new client.Counter({
      name: "feed_cursor_snapshot_creations_total",
      help: "Feed cursor snapshots successfully created",
      registers: [this.registry],
    });

    this.feedCursorSnapshotBuildCollisions = new client.Counter({
      name: "feed_cursor_snapshot_build_collisions_total",
      help: "Feed cursor snapshot builds coalesced locally or lost to another writer",
      registers: [this.registry],
    });

    this.feedCursorSnapshotBytes = new client.Histogram({
      name: "feed_cursor_snapshot_bytes",
      help: "Serialized feed cursor snapshot size in bytes",
      buckets: [1024, 4096, 16384, 65536, 262144, 1048576, 2097152],
      registers: [this.registry],
    });

    this.feedCursorSnapshotBuildDuration = new client.Histogram({
      name: "feed_cursor_snapshot_build_duration_seconds",
      help: "Feed cursor snapshot build duration",
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
      registers: [this.registry],
    });
    this.conversationActions = new client.Counter({
      name: "conversation_actions_total",
      help: "Conversation mutations by confirmed outcome; ambiguous commits are reported separately",
      labelNames: ["action", "outcome"], registers: [this.registry],
    });
    this.conversationActionDuration = new client.Histogram({
      name: "conversation_action_duration_seconds",
      help: "Conversation mutation latency including transaction retries",
      labelNames: ["action", "outcome"], registers: [this.registry],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
    });
    this.conversationCleanupAttempts = new client.Counter({
      name: "conversation_cleanup_attempts_total",
      help: "Conversation cache and request-log cleanup attempts, including retries",
      labelNames: ["outcome"], registers: [this.registry],
    });
  }

  public recordConversationAction(
    action: "delete" | "purge" | "lock" | "unlock",
    outcome: "succeeded" | "rejected" | "failed" | "ambiguous",
    durationMs: number,
  ): void {
    this.conversationActions.labels(action, outcome).inc();
    this.conversationActionDuration.labels(action, outcome).observe(durationMs / 1000);
  }

  public recordConversationCleanup(outcome: "succeeded" | "failed"): void {
    this.conversationCleanupAttempts.labels(outcome).inc();
  }

  public httpMetricsMiddleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const stopTimer = this.httpDuration.startTimer();
      res.once("finish", () => {
        const route = this.normalizeRoute(req);
        const status = String(res.statusCode);
        this.httpRequestsTotal.labels(req.method, route, status).inc();
        stopTimer({ method: req.method, route, status });
      });
      next();
    };
  }

  public async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }

  public markWorkerRunning(worker: string): void {
    this.workerStatus.labels(worker).set(1);
  }

  public markWorkerStopped(worker: string): void {
    this.workerStatus.labels(worker).set(0);
  }

  public markWorkerCrashed(worker: string): void {
    this.workerStatus.labels(worker).set(0);
    this.workerRestarts.labels(worker).inc();
  }

  public setRedisConnectionState(up: boolean): void {
    this.redisUp.set(up ? 1 : 0);
  }

  public recordOptionalAuthFailure(reason: string, route: string): void {
    this.optionalAuthFailuresTotal
      .labels(reason || "unknown", route || "unknown")
      .inc();
  }

  public recordDomainEventPublished(eventType: string, mode: string): void {
    this.domainEventsPublishedTotal
      .labels(eventType || "unknown", mode || "unknown")
      .inc();
  }

  public recordDomainEventStaged(eventType: string): void {
    this.domainEventsStagedTotal.labels(eventType).inc();
  }

  public recordDomainEventDispatchFailure(eventType: string, reason: "no_handlers" | "handler_failed"): void {
    this.domainEventDispatchFailures.labels(eventType, reason).inc();
  }

  public recordOutboxDeliveryIssue(eventType: string, reason: "no_handlers" | "ownership_lost" | "failure_persistence"): void {
    this.outboxDeliveryIssues.labels(eventType, reason).inc();
  }

  public recordOutboxPollCompleted(): void {
    this.outboxLastPollCompleted.set(Date.now() / 1000);
  }

  public registerTransactionMetrics(read: () => TransactionObservabilityMetrics): void {
    new client.Counter({
      name: "transactions_total", help: "Completed outer UnitOfWork operations by confirmed outcome",
      labelNames: ["outcome"], registers: [this.registry],
      collect() {
        const value = read();
        this.reset();
        this.labels("committed").inc(value.successfulTransactions);
        this.labels("failed").inc(value.failedTransactions);
        this.labels("ambiguous").inc(value.ambiguousTransactions);
        this.labels("rejected").inc(value.rejectedTransactions);
      },
    });
    new client.Counter({
      name: "transaction_attempts_total", help: "Transaction callback and commit attempts",
      labelNames: ["phase"], registers: [this.registry],
      collect() { const value = read(); this.reset(); this.labels("body").inc(value.totalAttempts); this.labels("commit").inc(value.commitAttempts); },
    });
    new client.Counter({
      name: "transaction_retries_total", help: "Scheduled transaction body and commit retries",
      labelNames: ["phase"], registers: [this.registry],
      collect() { const value = read(); this.reset(); this.labels("body").inc(value.bodyRetries); this.labels("commit").inc(value.commitRetries); },
    });
    new client.Counter({
      name: "transaction_duration_seconds_total", help: "Total outer operation duration including queue wait and cleanup",
      registers: [this.registry],
      collect() { this.reset(); this.inc(read().durationSeconds); },
    });
    new client.Counter({
      name: "transaction_queue_wait_seconds_total", help: "Total transaction admission wait including rejected operations",
      registers: [this.registry],
      collect() { this.reset(); this.inc(read().queueWaitSeconds); },
    });
    new client.Gauge({
      name: "transaction_queue_length", help: "Current outer UnitOfWork operations waiting for a transaction permit",
      registers: [this.registry], collect() { this.set(read().currentQueueLength); },
    });
    new client.Gauge({
      name: "transaction_available_permits", help: "Available UnitOfWork transaction permits",
      registers: [this.registry], collect() { this.set(read().availablePermits); },
    });
  }

  public recordRealtimeEventPublished(
    channel: string,
    status: "published" | "failed",
  ): void {
    this.realtimeEventsPublishedTotal
      .labels(channel || "unknown", status)
      .inc();
  }

  public recordSocketEventEmitted(
    eventName: string,
    target: "broadcast" | "room" | "socket",
  ): void {
    this.socketEventsEmittedTotal.labels(eventName || "unknown", target).inc();
  }

  public setOutboxPendingCount(count: number): void {
    this.outboxPendingEvents.set(Math.max(0, count));
  }

  public setOutboxBacklogStatus(
    exhaustedCount: number,
    oldestPendingAt?: Date,
  ): void {
    this.outboxExhaustedEvents.set(Math.max(0, exhaustedCount));
    const oldestAgeSeconds = oldestPendingAt
      ? Math.max(0, (Date.now() - oldestPendingAt.getTime()) / 1000)
      : 0;
    this.outboxOldestPendingAgeSeconds.set(oldestAgeSeconds);
  }

  public recordOutboxBatchSize(size: number): void {
    this.outboxBatchSize.observe(Math.max(0, size));
  }

  public recordOutboxAttempt(
    eventType: string,
    status: "processed" | "failed",
    durationMs: number,
  ): void {
    const normalizedEventType = eventType || "unknown";
    const normalizedDurationSeconds = Math.max(0, durationMs) / 1000;

    this.outboxEventsTotal.labels(normalizedEventType, status).inc();
    this.outboxEventDuration
      .labels(normalizedEventType, status)
      .observe(normalizedDurationSeconds);
  }

  public recordFeedCursorSnapshotAccess(hit: boolean): void {
    this.feedCursorSnapshotAccesses.labels(hit ? "hit" : "miss").inc();
  }

  public recordFeedCursorSnapshotCreation(
    bytes: number,
    durationMs: number,
  ): void {
    this.feedCursorSnapshotCreations.inc();
    this.feedCursorSnapshotBytes.observe(Math.max(0, bytes));
    this.feedCursorSnapshotBuildDuration.observe(
      Math.max(0, durationMs) / 1000,
    );
  }

  public recordFeedCursorSnapshotBuildCollision(): void {
    this.feedCursorSnapshotBuildCollisions.inc();
  }

  /**
   * Generic counter increment method for custom metrics.
   * Creates a counter if it doesn't exist.
   */
  public incrementCounter(
    name: string,
    labels: Record<string, string> = {},
  ): void {
    const labelNames = Object.keys(labels);
    const labelValues = Object.values(labels);

    // Try to find existing counter
    const existing = this.registry.getSingleMetric(name);

    if (existing && existing instanceof client.Counter) {
      existing.labels(...labelValues).inc();
    } else if (!existing) {
      // Create new counter if it doesn't exist
      const counter = new client.Counter({
        name,
        help: `Dynamic counter: ${name}`,
        labelNames,
        registers: [this.registry],
      });
      counter.labels(...labelValues).inc();
    }
  }

  private normalizeRoute(req: Request): string {
    const path = this.composeRoute(req);
    return path.replace(/[0-9a-fA-F]{8,}/g, ":id").replace(/\d+/g, ":id");
  }

  private composeRoute(req: Request): string {
    if (req.route?.path) {
      return `${req.baseUrl}${req.route.path}` || "/";
    }
    const raw = req.baseUrl || req.path || req.originalUrl || "/";
    const [pathOnly] = raw.split("?");
    return pathOnly || "/";
  }
}
