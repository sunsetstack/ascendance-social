import "reflect-metadata";
import dns from "node:dns";
import { errorLogger, logger } from "./utils/winston";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: "../.env" });
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
import { DatabaseConfig } from "./config/dbConfig";
import { Server } from "./server/server";
import { setupContainerCore, registerCQRS, initCQRS } from "./di/container";
import { WebSocketServer } from "./server/socketServer";
import { RealTimeFeedService } from "./services/feed/real-time-feed.service";
import { MetricsService } from "./metrics/metrics.service";
import { TrendingWorker } from "./workers/_impl/trending.worker.impl";
import { ProfileSyncWorker } from "./workers/_impl/profile-sync.worker.impl";
import { NewFeedWarmCacheWorker } from "./workers/_impl/newFeedWarmCache.worker.impl";
import { IpMonitorWorker } from "./workers/_impl/ip-monitor.worker.impl";
import { OutboxWorker } from "./workers/outbox.worker";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
// Global error handlers
process.on("uncaughtException", (error: Error) => {
  errorLogger.error({
    type: "UncaughtException",
    message: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
  console.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  errorLogger.error({
    type: "UnhandledRejection",
    reason: reason?.message || reason,
    stack: reason?.stack,
    promise: String(promise),
    timestamp: new Date().toISOString(),
  });
  console.error("Unhandled Rejection:", reason);
});

async function bootstrap(): Promise<void> {
  try {
    // make sure core registrations are in place
    setupContainerCore();

    const metricsService = container.resolve<MetricsService>("MetricsService");

    // Register CQRS tokens

    registerCQRS();

    // Connect to database
    const dbConfig = container.resolve(DatabaseConfig);
    await dbConfig.connect();

    // Now that DB connection is established, resolve & wire CQRS handlers (buses, handlers, subscriptions).
    initCQRS();

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
      const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
      expressServer.start(server, port);
    } else {
      logger.info("API server disabled via ENABLE_API=false");
    }
  } catch (error) {
    console.error("Startup failed", error);
    process.exit(1);
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
    // trending worker
    const trendingWorker = container.resolve(TrendingWorker);
    await trendingWorker.init();
    trendingWorker.start();
    metricsService.markWorkerRunning("trending.worker");
    logger.info("Started in-process worker: trending");

    // profile-sync worker
    const profileSyncWorker = new ProfileSyncWorker();
    await profileSyncWorker.init();
    await profileSyncWorker.start();
    metricsService.markWorkerRunning("profile-sync.worker");
    logger.info("Started in-process worker: profile-sync");

    // new feed warm cache worker
    const newFeedWarmCacheWorker = new NewFeedWarmCacheWorker();
    await newFeedWarmCacheWorker.init();
    newFeedWarmCacheWorker.start();
    metricsService.markWorkerRunning("newFeedWarmCache.worker");
    logger.info("Started in-process worker: newFeedWarmCache");

    // ip monitor worker
    const ipMonitorWorker = new IpMonitorWorker();
    await ipMonitorWorker.init();
    ipMonitorWorker.start();
    metricsService.markWorkerRunning("ip-monitor.worker");
    logger.info("Started in-process worker: ip-monitor");

    // outbox worker
    const outboxWorker = container.resolve(OutboxWorker);
    outboxWorker.start();
    metricsService.markWorkerRunning("outbox.worker");
    logger.info("Started in-process worker: outbox");

    logger.info("All in-process workers started successfully");
  } catch (error) {
    logger.error("Failed to start in-process workers", { error });
    // don't crash the server if workers fail - they're non-critical
  }
}

bootstrap();
