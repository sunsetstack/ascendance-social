import mongoose, { ConnectOptions } from "mongoose";
import { singleton } from "tsyringe";
import { z } from "zod";
import pino from "pino";

// Validate & parse env early
const envSchema = z.object({
  MONGODB_URI: z.string().url().default("mongodb://127.0.0.1:27017/image-app"),
  DB_MAX_RETRIES: z.coerce.number().default(10),
  DB_RETRY_INTERVAL_MS: z.coerce.number().default(5000),
});
const env = envSchema.parse(process.env);

// Central logger
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
});

@singleton()
export class DatabaseConfig {
  private uri = env.MONGODB_URI;
  private maxRetries = env.DB_MAX_RETRIES;
  private retryInterval = env.DB_RETRY_INTERVAL_MS;

  constructor() {
    this.handleProcessSignals();
  }

  private async tryConnect(attempt = 1): Promise<void> {
    const opts: ConnectOptions = {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    };

    try {
      await mongoose.connect(this.uri, opts);
      logger.info("Database connected");
      this.registerConnectionEvents();
    } catch (err: unknown) {
      logger.error({ err, attempt }, `Connection attempt ${attempt} failed`);
      if (attempt < this.maxRetries) {
        logger.info(`Retrying in ${this.retryInterval}ms…`);
        await new Promise((r) => setTimeout(r, this.retryInterval));
        return this.tryConnect(attempt + 1);
      } else {
        logger.fatal("Exceeded max DB connection attempts, exiting");
        process.exit(1);
      }
    }
  }

  public async connect(): Promise<void> {
    await this.tryConnect();
  }

  public async disconnect(): Promise<void> {
    await mongoose.disconnect();
    logger.info("Database disconnected");
  }

  // 3. Log disconnects, errors, re-connects
  private registerConnectionEvents() {
    mongoose.connection.on("disconnected", () =>
      logger.warn("MongoDB disconnected"),
    );
    mongoose.connection.on("reconnected", () =>
      logger.info("MongoDB reconnected"),
    );
    mongoose.connection.on("error", (err) =>
      logger.error({ err }, "MongoDB error"),
    );
  }

  // Graceful shutdown
  private handleProcessSignals() {
    const shutdown = async () => {
      await this.disconnect();
      process.exit(0);
    };
    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((sig) =>
      process.on(sig, shutdown),
    );
  }
}
