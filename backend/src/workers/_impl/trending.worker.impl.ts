import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import { performance } from "perf_hooks";
import {
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  ReconnectStrategyError,
  RootNodesUnavailableError,
  SocketClosedUnexpectedlyError,
} from "redis";
import { MetricsService } from "@/metrics/metrics.service";
import type { FeedPost } from "@/types";
import { logger } from "@/utils/winston";
import {
  addRequestContextBreadcrumb,
  getRequestContext,
  runWithRequestContext,
} from "@/runtime/request-context";
import { logNonHttpTerminalError } from "@/runtime/non-http-error-logger";
import { randomUUID } from "node:crypto";
import type { IFeedReadDao } from "@/repositories/interfaces";
import { TOKENS } from "@/types/tokens";
import type {
  ITrendingProjectionService,
  ITrendingStreamConsumer,
  TrendingProjectionBatch,
  TrendingStreamClient,
  TrendingStreamConfig,
  TrendingStreamMessage,
} from "@/workers/trending/trending.ports";

/**
 * Coordinates trending feed stream processing and cache projection.
 * This worker uses a classic write-behind cache pattern. It runs the expensive mongo aggregation once
 * and updates the top 500(can be adjusted) posts in Redis sorted set
 * Stores post metadata in Redis cache
 * massively reducing database load and providing faster API responses for trending feed.
 * TRENDING_BATCH_MS=2000           # How often to process stream events (2s)
 * TRENDING_FULL_REFRESH_MS=300000  # How often to refresh all posts (5min)
 * TRENDING_READ_COUNT=100          # Stream batch size
 *
 * It periodically refreshes the trending feed while pre-computing everything in the background
 * allowing for the API to serve cached results with real-time updates via Redis Streams.
 *
 * It also falls back to Mongo if Redis is empty (graceful degradation)
 *
 * The point of this thing is to allow handling a high volume of concurrent users.
 * It can be replicated for other feeds.
 */

type PendingDeltas = {
  commentsDelta: number;
  likesDelta: number;
  lastSeen: number;
  messageIds: string[];
};

type ReadLoopOutcome =
  | { kind: "stopped" }
  | {
      kind: "failed";
      error: unknown;
      terminalRecorded: boolean;
      operationId?: string;
      loggingError?: unknown;
    };

@injectable()
export class TrendingWorker {
  private STREAM = "stream:interactions";
  private GROUP = "trendingGroup";
  private CONSUMER = `trending-${process.env.HOSTNAME ?? "local"}-${process.pid}`;
  private BATCH_WINDOW_MS = Number(process.env.TRENDING_BATCH_MS) || 2000; // calc and update trend scores every 2 secs
  private READ_COUNT = Number(process.env.TRENDING_READ_COUNT) || 100;
  private RECLAIM_MIN_IDLE_MS =
    Number(process.env.TRENDING_RECLAIM_MS) || 60_000;
  private RECLAIM_INTERVAL_MS =
    Number(process.env.TRENDING_RECLAIM_INTERVAL_MS) || 30_000;
  private CHUNK_SIZE = 50;
  private FULL_REFRESH_INTERVAL_MS =
    Number(process.env.TRENDING_FULL_REFRESH_MS) || 300_000; // full refresh every 5 min
  private REDIS_STARTUP_TIMEOUT_MS = 5000;

  private redisClient: TrendingStreamClient | null = null;

  private pending = new Map<string, PendingDeltas>();
  private flushing = false;
  private running = false;
  private stopping = false;
  private readLoopTask?: Promise<ReadLoopOutcome>;
  private readLoopGeneration = 0;
  private flushTimer?: NodeJS.Timeout;
  private reclaimTimer?: NodeJS.Timeout;
  private fullRefreshTimer?: NodeJS.Timeout;
  private inFlightCallbacks = new Set<Promise<void>>();
  private readonly runReadLoopInContext = runWithRequestContext;

  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Services.TrendingStreamConsumer)
    private readonly streamConsumer: ITrendingStreamConsumer,
    @inject(TOKENS.Services.TrendingProjection)
    private readonly projectionService: ITrendingProjectionService,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService?: MetricsService,
  ) {}

  private getStreamConfig(): TrendingStreamConfig {
    return {
      stream: this.STREAM,
      group: this.GROUP,
      consumer: this.CONSUMER,
      readCount: this.READ_COUNT,
      reclaimMinIdleMs: this.RECLAIM_MIN_IDLE_MS,
    };
  }

  /** initialize dependencies and create consumer group if necessary */
  async init(): Promise<void> {
    const operationId = randomUUID();
    await runWithRequestContext(
      { correlationId: operationId, requestStartTime: process.hrtime.bigint() },
      async () => {
        addRequestContextBreadcrumb("worker.trending.startup.started", {
          worker: "TrendingWorker",
        });
        this.redisClient = await this.streamConsumer.initialize(
          this.getStreamConfig(),
          this.REDIS_STARTUP_TIMEOUT_MS,
        );
        addRequestContextBreadcrumb("worker.trending.startup.completed", {
          worker: "TrendingWorker",
        });
        logger.info(
          `[trending] ensured consumer group ${this.GROUP} on ${this.STREAM}`,
        );
      },
    );
  }

  /** start reading stream and flushing batches */
  async start(): Promise<void> {
    if (this.readLoopTask) return;

    const previousGeneration = this.readLoopGeneration;
    if (
      previousGeneration > 0 &&
      !this.running &&
      !this.stopping &&
      this.inFlightCallbacks.size > 0
    ) {
      await Promise.allSettled([...this.inFlightCallbacks]);
      if (
        this.readLoopTask ||
        this.readLoopGeneration !== previousGeneration ||
        this.stopping
      ) {
        return;
      }
    }

    this.stopping = false;
    this.running = true;

    const generation = ++this.readLoopGeneration;
    const readLoopTask = this.readLoop();
    this.readLoopTask = readLoopTask;
    this.ownReadLoopTask(readLoopTask, generation);

    this.flushTimer = setInterval(() => {
      this.trackBackgroundRoot("flush_pending", () => this.flushPending());
    }, this.BATCH_WINDOW_MS);

    this.reclaimTimer = setInterval(() => {
      this.trackBackgroundRoot("reclaim_stalled_messages", () =>
        this.reclaimStalledMessages(),
      );
    }, this.RECLAIM_INTERVAL_MS);

    // periodically refresh entire trending feed to catch posts without recent interactions
    this.fullRefreshTimer = setInterval(() => {
      this.trackBackgroundRoot("full_refresh", () => this.fullRefresh());
    }, this.FULL_REFRESH_INTERVAL_MS);

    // run initial full refresh on startup
    this.trackBackgroundRoot("initial_full_refresh", () => this.fullRefresh());

    this.updateWorkerMetric("running");
    logger.info(`[trending] worker started (consumer=${this.CONSUMER})`);
  }

  /** stop reading and gracefully shutdown (flush pending) */
  async stop(): Promise<void> {
    const operationId = randomUUID();
    await runWithRequestContext(
      { correlationId: operationId, requestStartTime: process.hrtime.bigint() },
      async () => {
        this.stopping = true;
        this.running = false;
        this.clearTimers();
        this.updateWorkerMetric("stopped");
        addRequestContextBreadcrumb("worker.trending.shutdown.started", {
          worker: "TrendingWorker",
        });

        const readLoopTask = this.readLoopTask;
        if (readLoopTask) {
          await readLoopTask;
          if (this.readLoopTask === readLoopTask) {
            this.readLoopTask = undefined;
          }
        }

        await Promise.allSettled(this.inFlightCallbacks);
        await this.flushPending();
        const redisClient = this.redisClient;
        if (redisClient?.isOpen) {
          await this.streamConsumer.close(redisClient);
        }
        this.redisClient = null;
        addRequestContextBreadcrumb("worker.trending.shutdown.completed", {
          worker: "TrendingWorker",
        });
        logger.info("[trending] worker stopped");
      },
    );
  }

  /** main read loop that consumes stream messages using XREADGROUP via clientInstance */
  private async readLoop(): Promise<ReadLoopOutcome> {
    let operationId: string | undefined;
    try {
      const readLoopOperationId = randomUUID();
      operationId = readLoopOperationId;
      return await this.runReadLoopInContext(
        {
          correlationId: readLoopOperationId,
          requestStartTime: process.hrtime.bigint(),
        },
        async (): Promise<ReadLoopOutcome> => {
          try {
            addRequestContextBreadcrumb("worker.trending.callback.started", {
              worker: "TrendingWorker",
              operation: "read_loop",
            });
            while (this.running && this.redisClient) {
              await this.readLoopIteration();
            }
            if (this.stopping || !this.running) {
              addRequestContextBreadcrumb(
                "worker.trending.callback.completed",
                {
                  worker: "TrendingWorker",
                  operation: "read_loop",
                },
              );
              return { kind: "stopped" };
            }
            return this.recordReadLoopFailure(
              new Error(
                "Trending read loop exited while the worker remained running",
              ),
              readLoopOperationId,
            );
          } catch (error) {
            if (this.stopping && isExpectedRedisClientShutdownError(error)) {
              return { kind: "stopped" };
            }
            return this.recordReadLoopFailure(error, readLoopOperationId);
          }
        },
      );
    } catch (error) {
      return {
        kind: "failed",
        error,
        terminalRecorded: false,
        ...(operationId === undefined ? {} : { operationId }),
      };
    }
  }

  private ownReadLoopTask(
    readLoopTask: Promise<ReadLoopOutcome>,
    generation: number,
  ): void {
    void readLoopTask
      .then(
        (outcome) => this.settleReadLoopTask(readLoopTask, generation, outcome),
        (error) =>
          this.settleReadLoopTask(readLoopTask, generation, {
            kind: "failed",
            error,
            terminalRecorded: false,
          }),
      )
      .catch((ownershipError) => {
        this.handleReadLoopOwnershipFailure(
          readLoopTask,
          generation,
          ownershipError,
        );
      });
  }

  private settleReadLoopTask(
    readLoopTask: Promise<ReadLoopOutcome>,
    generation: number,
    outcome: ReadLoopOutcome,
  ): void {
    if (
      this.readLoopTask !== readLoopTask ||
      this.readLoopGeneration !== generation
    ) {
      return;
    }

    this.readLoopTask = undefined;
    if (outcome.kind !== "failed") {
      return;
    }

    if (!this.stopping) {
      this.running = false;
      this.clearTimers();
      this.updateWorkerMetric("crashed");
    }
    if (!outcome.terminalRecorded) {
      this.reportUnrecordedReadLoopFailure(outcome);
    }
  }

  private recordReadLoopFailure(
    error: unknown,
    operationId: string,
  ): ReadLoopOutcome {
    try {
      addRequestContextBreadcrumb("worker.trending.callback.failed", {
        worker: "TrendingWorker",
        operation: "read_loop",
      });
      logNonHttpTerminalError(error, {
        message: "Trending worker background callback failed",
        event: "worker.trending.callback.failed",
        operation: "worker.trending.read_loop",
        operationId,
        worker: "TrendingWorker",
        breadcrumbs: getRequestContext()?.breadcrumbs,
      });
      return {
        kind: "failed",
        error,
        terminalRecorded: true,
        operationId,
      };
    } catch (loggingError) {
      return {
        kind: "failed",
        error,
        terminalRecorded: false,
        operationId,
        loggingError,
      };
    }
  }

  private reportUnrecordedReadLoopFailure(
    outcome: Extract<ReadLoopOutcome, { kind: "failed" }>,
  ): void {
    try {
      logNonHttpTerminalError(outcome.error, {
        message: "Trending worker background callback failed",
        event: "worker.trending.callback.failed",
        operation: "worker.trending.read_loop",
        ...(outcome.operationId === undefined
          ? {}
          : { operationId: outcome.operationId }),
        worker: "TrendingWorker",
        breadcrumbs: getRequestContext()?.breadcrumbs,
      });
    } catch (fallbackLoggingError) {
      try {
        logger.error("Trending worker read-loop terminal logging failed", {
          event: "worker.trending.read_loop.terminal_logging_failed",
          worker: "TrendingWorker",
          workerError: outcome.error,
          loggingError: outcome.loggingError,
          fallbackLoggingError,
        });
      } catch {}
    }
  }

  private handleReadLoopOwnershipFailure(
    readLoopTask: Promise<ReadLoopOutcome>,
    generation: number,
    ownershipError: unknown,
  ): void {
    try {
      if (
        this.readLoopTask === readLoopTask &&
        this.readLoopGeneration === generation
      ) {
        this.readLoopTask = undefined;
        this.running = false;
        this.clearTimers();
        this.updateWorkerMetric("crashed");
      }
      try {
        logger.error("Trending worker read-loop ownership failed", {
          event: "worker.trending.read_loop.ownership_failed",
          worker: "TrendingWorker",
          error: ownershipError,
        });
      } catch {}
    } catch {}
  }

  private clearTimers(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.reclaimTimer) {
      clearInterval(this.reclaimTimer);
      this.reclaimTimer = undefined;
    }
    if (this.fullRefreshTimer) {
      clearInterval(this.fullRefreshTimer);
      this.fullRefreshTimer = undefined;
    }
  }

  private updateWorkerMetric(state: "running" | "stopped" | "crashed"): void {
    try {
      if (state === "running") {
        this.metricsService?.markWorkerRunning("trending.worker");
      } else if (state === "stopped") {
        this.metricsService?.markWorkerStopped("trending.worker");
      } else {
        this.metricsService?.markWorkerCrashed("trending.worker");
      }
    } catch (error) {
      try {
        logger.warn("Trending worker metric transition failed", {
          event: "worker.trending.metric_transition.failed",
          worker: "TrendingWorker",
          state,
          error,
        });
      } catch {}
    }
  }

  private async readLoopIteration(): Promise<void> {
    const redisClient = this.redisClient;
    if (!redisClient) {
      throw new Error("Trending Redis client is not initialized");
    }

    let messages: TrendingStreamMessage[];
    try {
      messages = await this.streamConsumer.read(
        redisClient,
        this.getStreamConfig(),
      );
    } catch (err) {
      if (this.stopping && isExpectedRedisClientShutdownError(err)) {
        return;
      }
      if (!isRetryableRedisTransportError(err)) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn("[trending] readLoop error", {
        message: errorMessage,
        error: err,
      });
      await this.sleep(1000);
      return;
    }

    for (const message of messages) {
      this.trackBackgroundRoot("handle_stream_message", () =>
        this.handleStreamMessage(message.id, message.fields),
      );
    }
  }

  /** handle a single stream message: coalesce it for the next flush */
  private async handleStreamMessage(
    id: string,
    fields: Record<string, string>,
  ): Promise<void> {
    if (this.stopping) {
      return;
    }
    const postId = fields.postId ?? fields.postPublicId ?? fields.post;

    if (!postId) {
      logger.warn(`[trending] malformed message ${id} missing postId - acking`);
      await this.streamConsumer.acknowledge(this.getStreamConfig(), [id]);
      return;
    }

    const now = Date.now();
    const existing = this.pending.get(postId) ?? {
      commentsDelta: 0,
      likesDelta: 0,
      lastSeen: now,
      messageIds: [],
    };
    existing.lastSeen = now;
    if (!existing.messageIds.includes(id)) {
      existing.messageIds.push(id);
    }
    this.pending.set(postId, existing);
  }

  private requeueEntries(entries: Array<[string, PendingDeltas]>): void {
    for (const [postId, entry] of entries) {
      const existing = this.pending.get(postId);
      if (!existing) {
        this.pending.set(postId, {
          ...entry,
          messageIds: [...entry.messageIds],
        });
        continue;
      }

      existing.lastSeen = Math.max(existing.lastSeen, entry.lastSeen);
      for (const messageId of entry.messageIds) {
        if (!existing.messageIds.includes(messageId)) {
          existing.messageIds.push(messageId);
        }
      }
      this.pending.set(postId, existing);
    }
  }

  /** Flush pending map: compute score per post and update ZSET via helper */
  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    if (this.pending.size === 0) return;
    this.flushing = true;
    const start = performance.now();

    try {
      const entries = Array.from(this.pending.entries());
      this.pending.clear();

      for (let i = 0; i < entries.length; i += this.CHUNK_SIZE) {
        const chunk = entries.slice(i, i + this.CHUNK_SIZE);
        const postIds = chunk.map(([postId]) => postId);
        let posts: FeedPost[];

        try {
          posts =
            await this.projectionService.findPostsByPublicIds(postIds);
        } catch (error) {
          this.requeueEntries(chunk);
          logger.warn("[trending] repository read failed during flush", {
            error,
          });
          continue;
        }

        const messageIdsToAck = chunk.flatMap(
          ([, pendingEntry]) => pendingEntry.messageIds,
        );
        let projection: TrendingProjectionBatch;
        try {
          projection = this.projectionService.preparePendingUpdates(
            posts,
            postIds,
          );
        } catch (error) {
          this.requeueEntries(chunk);
          throw error;
        }

        for (const postId of projection.missingPostIds) {
          logger.warn(
            `[trending] post ${postId} missing during flush; acknowledging pending messages`,
          );
        }
        for (const update of projection.updates) {
          logger.debug(
            `[trending] ${update.postId}: likes=${update.likes}, comments=${update.comments}, age=${update.ageDays.toFixed(1)}d, ` +
              `recency=${update.recencyScore.toFixed(3)}, popularity=${update.popularityScore.toFixed(3)}, score=${update.score.toFixed(3)}`,
          );
        }

        try {
          await this.projectionService.writeUpdates(projection.updates);
        } catch (error) {
          this.requeueEntries(chunk);
          logger.warn("[trending] Redis cache write failed during flush", {
            error,
          });
          continue;
        }

        if (messageIdsToAck.length > 0) {
          try {
            await this.streamConsumer.acknowledge(
              this.getStreamConfig(),
              messageIdsToAck,
            );
          } catch (error) {
            this.requeueEntries(chunk);
            logger.warn("[trending] stream ACK failed during flush", { error });
            continue;
          }
        }
      }
    } finally {
      this.flushing = false;
      const dur = performance.now() - start;
      logger.info(`[trending] flushed updates (${dur.toFixed(1)}ms)`);
    }
  }

  /** reclaim messages that are pending (XPENDING) and idle for > RECLAIM_MIN_IDLE_MS using helpers */
  private async reclaimStalledMessages(): Promise<void> {
    let toClaim: string[];
    try {
      toClaim = await this.streamConsumer.findReclaimableMessageIds(
        this.getStreamConfig(),
        1000,
      );
    } catch (err) {
      if (this.stopping && isExpectedRedisClientShutdownError(err)) {
        return;
      }
      if (!isRetryableRedisTransportError(err)) {
        throw err;
      }
      logger.warn("[trending] XPENDING failed; deferring reclaim", {
        error: err,
      });
      return;
    }

    if (toClaim.length === 0) return;

    let claimed: TrendingStreamMessage[];
    try {
      claimed = await this.streamConsumer.claim(
        this.getStreamConfig(),
        toClaim,
      );
    } catch (err) {
      if (this.stopping && isExpectedRedisClientShutdownError(err)) {
        return;
      }
      if (!isRetryableRedisTransportError(err)) {
        throw err;
      }
      logger.warn("[trending] XCLAIM failed; deferring reclaim", {
        error: err,
      });
      return;
    }

    for (const message of claimed) {
      try {
        await this.handleStreamMessage(message.id, message.fields);
      } catch (err) {
        if (this.stopping && isExpectedRedisClientShutdownError(err)) {
          return;
        }
        if (!isRetryableRedisTransportError(err)) {
          throw err;
        }
        logger.warn("[trending] reclaimed message remains pending", {
          error: err,
        });
      }
    }
  }

  /**
   * Full refresh: recalculate scores for all posts in time window
   * This ensures posts without recent interactions still get ranked
   */
  private async fullRefresh(): Promise<void> {
    logger.info("[trending] starting full refresh...");
    const start = performance.now();

    const timeWindowDays = 14;
    const limit = 500;
    let result: unknown;
    try {
      result = await this.feedReadDao.getTrendingFeedWithCursor({
        limit,
        timeWindowDays,
        minLikes: 0,
      });
    } catch (error) {
      logger.warn("[trending] full refresh DAO query failed", { error });
      return;
    }

    if (!isRecord(result) || !Array.isArray(result.data)) {
      throw new TypeError("Malformed trending full-refresh result");
    }
    if (result.data.length === 0) {
      logger.warn("[trending] no posts found for full refresh");
      return;
    }

    const cacheUpdates = this.projectionService.prepareRefreshUpdates(
      result.data,
    );
    try {
      await this.projectionService.writeUpdates(cacheUpdates);
    } catch (error) {
      logger.warn("[trending] full refresh Redis cache write failed", {
        error,
      });
      return;
    }

    const dur = performance.now() - start;
    logger.info(
      `[trending] full refresh completed: ${result.data.length} posts updated (${dur.toFixed(1)}ms)`,
    );
  }

  private async runBackgroundRoot(
    operation: string,
    work: () => Promise<void>,
  ): Promise<void> {
    if (this.stopping) {
      return;
    }
    const operationId = randomUUID();
    await runWithRequestContext(
      { correlationId: operationId, requestStartTime: process.hrtime.bigint() },
      async () => {
        addRequestContextBreadcrumb("worker.trending.callback.started", {
          worker: "TrendingWorker",
          operation,
        });
        try {
          await work();
          addRequestContextBreadcrumb("worker.trending.callback.completed", {
            worker: "TrendingWorker",
            operation,
          });
        } catch (error) {
          if (this.stopping && isExpectedRedisClientShutdownError(error)) {
            return;
          }
          addRequestContextBreadcrumb("worker.trending.callback.failed", {
            worker: "TrendingWorker",
            operation,
          });
          logNonHttpTerminalError(error, {
            message: "Trending worker background callback failed",
            event: "worker.trending.callback.failed",
            operation: `worker.trending.${operation}`,
            operationId,
            worker: "TrendingWorker",
            breadcrumbs: getRequestContext()?.breadcrumbs,
          });
        }
      },
    );
  }

  private trackBackgroundRoot(
    operation: string,
    work: () => Promise<void>,
  ): void {
    const callback = this.runBackgroundRoot(operation, work);
    this.inFlightCallbacks.add(callback);
    void callback.then(
      () => this.inFlightCallbacks.delete(callback),
      () => this.inFlightCallbacks.delete(callback),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function isExpectedRedisClientShutdownError(error: unknown): boolean {
  return (
    error instanceof ClientClosedError ||
    error instanceof DisconnectsClientError
  );
}

const RETRYABLE_REDIS_TRANSPORT_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);

function isRetryableRedisTransportError(error: unknown): boolean {
  if (
    error instanceof ClientOfflineError ||
    error instanceof ConnectionTimeoutError ||
    error instanceof ReconnectStrategyError ||
    error instanceof RootNodesUnavailableError ||
    error instanceof SocketClosedUnexpectedlyError
  ) {
    return true;
  }
  if (!isRecord(error)) {
    return false;
  }
  return (
    typeof error.code === "string" &&
    RETRYABLE_REDIS_TRANSPORT_CODES.has(error.code)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
