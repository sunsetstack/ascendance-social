import "reflect-metadata";
import "./runtime/bootstrap-env";
import { logger } from "./utils/winston";
import mongoose from "mongoose";
// Register global mongoose plugin before individual models
mongoose.plugin((schema) => {
  schema.set("toJSON", {
    transform: (doc, ret: Record<string, any>) => {
      if (ret._id) {
        ret.id = ret._id.toString();
        delete ret._id;
      }
      delete ret.__v;
      return ret;
    },
  });
});

import { createServer } from "http";
import { container } from "tsyringe";
import { Server } from "./server/server";
import { WebSocketServer } from "./server/socketServer";
import { RealTimeFeedService } from "./services/feed/real-time-feed.service";
import { MetricsService } from "./metrics/metrics.service";
import { TrendingWorker } from "./workers/_impl/trending.worker.impl";
import { ProfileSyncWorker } from "./workers/_impl/profile-sync.worker.impl";
import { NewFeedWarmCacheWorker } from "./workers/_impl/newFeedWarmCache.worker.impl";
import { IpMonitorWorker } from "./workers/_impl/ip-monitor.worker.impl";
import { OutboxWorker } from "./workers/outbox.worker";
import { initializeBackendRuntime } from "./runtime/backend-runtime";
import { registerGlobalProcessHandlers } from "./runtime/process-handlers";

registerGlobalProcessHandlers();

type WorkerStartup = {
  metricName: string;
  displayName: string;
  critical?: boolean;
  start: () => Promise<void>;
};

function resolvePort(): number {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    return 3000;
  }

  const port = Number.parseInt(rawPort, 10);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${rawPort}`);
  }

  return port;
}

async function bootstrap(): Promise<void> {
  try {
    await initializeBackendRuntime();
    const metricsService = container.resolve<MetricsService>("MetricsService");

    // Start workers in-process (same event loop - I/O bound, no need for threads)
    await startInProcessWorkers(metricsService);

    if (process.env.ENABLE_API !== "false") {
      // Create Express app and HTTP server
      const expressServer = container.resolve(Server);
      const app = expressServer.getExpressApp();
      const server = createServer(app);

      // Resolve and initialize WebSocket server
      const webSocketServer =
        container.resolve<WebSocketServer>("WebSocketServer");
      webSocketServer.initialize(server);

      // Initialize real-time feed service
      container.resolve<RealTimeFeedService>("RealTimeFeedService");
      logger.info("Real-time feed service initialized");

      // Start the HTTP server last
      const port = resolvePort();
      expressServer.start(server, port);
    } else {
      logger.info("API server disabled via ENABLE_API=false");
    }
  } catch (error) {
    logger.error("Startup failed", { error });
    process.exit(1);
  }
}

async function startWorker(
  metricsService: MetricsService,
  { metricName, displayName, critical = false, start }: WorkerStartup,
): Promise<void> {
  try {
    await start();
    metricsService.markWorkerRunning(metricName);
    logger.info(`Started in-process worker: ${displayName}`);
  } catch (error) {
    metricsService.markWorkerStopped(metricName);
    logger.error(`Failed to start ${critical ? "critical" : "optional"} worker`, {
      worker: metricName,
      error,
    });

    if (critical) {
      throw error;
    }

    logger.warn("Continuing startup without optional worker", {
      worker: metricName,
    });
  }
}

async function startInProcessWorkers(
  metricsService: MetricsService,
): Promise<void> {
  if (process.env.ENABLE_WORKERS === "false") {
    logger.info("Workers disabled via ENABLE_WORKERS=false");
    return;
  }

  try {
    const scheduledWorkersEnabled =
      process.env.ENABLE_SCHEDULED_WORKERS !== "false";

    if (scheduledWorkersEnabled) {
      await startWorker(metricsService, {
        metricName: "trending.worker",
        displayName: "trending",
        start: async () => {
          const trendingWorker = container.resolve(TrendingWorker);
          await trendingWorker.init();
          await trendingWorker.start();
        },
      });

      await startWorker(metricsService, {
        metricName: "profile-sync.worker",
        displayName: "profile-sync",
        start: async () => {
          const profileSyncWorker = container.resolve(ProfileSyncWorker);
          await profileSyncWorker.start();
        },
      });

      await startWorker(metricsService, {
        metricName: "newFeedWarmCache.worker",
        displayName: "newFeedWarmCache",
        start: async () => {
          const newFeedWarmCacheWorker = container.resolve(NewFeedWarmCacheWorker);
          await newFeedWarmCacheWorker.init();
          await newFeedWarmCacheWorker.start();
        },
      });
    } else {
      logger.info(
        "Scheduled in-process workers disabled via ENABLE_SCHEDULED_WORKERS=false",
      );
    }

    await startWorker(metricsService, {
      metricName: "outbox.worker",
      displayName: "outbox",
      critical: true,
      start: async () => {
        const outboxWorker = container.resolve(OutboxWorker);
        await outboxWorker.start();
      },
    });

    await startWorker(metricsService, {
      metricName: "ip-monitor.worker",
      displayName: "ip-monitor",
      start: async () => {
        const ipMonitorWorker = container.resolve(IpMonitorWorker);
        await ipMonitorWorker.start();
      },
    });

    logger.info("All in-process workers started successfully");
  } catch (error) {
    logger.error("Failed to start in-process workers", { error });
    throw error;
  }
}

bootstrap();
