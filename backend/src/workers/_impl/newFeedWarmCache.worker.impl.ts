import { inject, injectable } from "tsyringe";
import * as cron from "node-cron";
import { FeedService } from "@/services/feed/feed.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import {
  addRequestContextBreadcrumb,
  getRequestContext,
  runWithRequestContext,
} from "@/runtime/request-context";
import { logNonHttpTerminalError } from "@/runtime/non-http-error-logger";
import { randomUUID } from "node:crypto";

@injectable()
export class NewFeedWarmCacheWorker {
  private cronJob?: cron.ScheduledTask;
  private stopping = false;
  private scheduleCron: typeof cron.schedule = cron.schedule;
  private activeRefresh?: Promise<void>;
  private inFlightRefreshes = new Set<Promise<void>>();
  private shutdown?: Promise<void>;

  constructor(
    @inject(TOKENS.Services.Feed)
    private readonly feedService: FeedService,
  ) {}

  async init(): Promise<void> {
    logger.info("New feed warm cache worker initialized");
    // run immediately on startup
    await this.admitRefresh("startup_cache_refresh");
  }

  start(): void {
    if (this.cronJob) return;

    const shutdown = this.shutdown;
    if (shutdown) {
      void shutdown.then(
        () => {
          if (!this.shutdown) {
            this.stopping = false;
          }
        },
        () => undefined,
      );
    } else {
      this.stopping = false;
    }
    // run every hour to keep cache warm
    this.cronJob = this.scheduleCron("0 * * * *", () => {
      void this.admitRefresh("scheduled_cache_refresh");
    });

    logger.info(
      "New feed warm cache worker started (runs every hour via cron)",
    );
  }

  async stop(): Promise<void> {
    if (this.shutdown) {
      await this.shutdown;
      return;
    }
    this.stopping = true;
    const operationId = randomUUID();
    const shutdown = runWithRequestContext(
      { correlationId: operationId, requestStartTime: process.hrtime.bigint() },
      async () => {
        addRequestContextBreadcrumb("worker.new_feed_warm_cache.shutdown.started", {
          worker: "NewFeedWarmCacheWorker",
        });
        if (this.cronJob) {
          this.cronJob.stop();
          this.cronJob = undefined;
        }
        await Promise.allSettled(this.inFlightRefreshes);
        addRequestContextBreadcrumb("worker.new_feed_warm_cache.shutdown.completed", {
          worker: "NewFeedWarmCacheWorker",
        });
        logger.info("New feed warm cache worker stopped");
      },
    );
    this.shutdown = shutdown;
    try {
      await shutdown;
    } finally {
      if (this.shutdown === shutdown) {
        this.shutdown = undefined;
      }
    }
  }

  private async run(): Promise<void> {
    logger.info("Running new feed warm cache worker...");
    await this.feedService.prewarmNewFeed();
    logger.info("New feed warm cache worker completed successfully");
  }

  private admitRefresh(operation: string): Promise<void> {
    if (this.activeRefresh) {
      return this.activeRefresh;
    }
    if (this.stopping) {
      return Promise.resolve();
    }

    const refresh = this.runBackgroundRoot(operation, () => this.run());
    this.activeRefresh = refresh;
    this.inFlightRefreshes.add(refresh);
    void refresh.then(
      () => this.finishRefresh(refresh),
      () => this.finishRefresh(refresh),
    );
    return refresh;
  }

  private finishRefresh(refresh: Promise<void>): void {
    this.inFlightRefreshes.delete(refresh);
    if (this.activeRefresh === refresh) {
      this.activeRefresh = undefined;
    }
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
        addRequestContextBreadcrumb(
          "worker.new_feed_warm_cache.callback.started",
          { worker: "NewFeedWarmCacheWorker", operation },
        );
        try {
          await work();
          addRequestContextBreadcrumb(
            "worker.new_feed_warm_cache.callback.completed",
            { worker: "NewFeedWarmCacheWorker", operation },
          );
        } catch (error) {
          addRequestContextBreadcrumb(
            "worker.new_feed_warm_cache.callback.failed",
            { worker: "NewFeedWarmCacheWorker", operation },
          );
          logNonHttpTerminalError(error, {
            message: "New feed warm cache worker background callback failed",
            event: "worker.new_feed_warm_cache.callback.failed",
            operation: `worker.new_feed_warm_cache.${operation}`,
            operationId,
            worker: "NewFeedWarmCacheWorker",
            breadcrumbs: getRequestContext()?.breadcrumbs,
          });
        }
      },
    );
  }
}
