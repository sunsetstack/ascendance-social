import mongoose, { ConnectOptions } from "mongoose";
import { singleton } from "tsyringe";
import { z } from "zod";
import { logger } from "@/utils/winston";

const envSchema = z.object({
  MONGODB_URI: z.string().url(),
  DB_MAX_RETRIES: z.coerce.number().default(10),
  DB_RETRY_INTERVAL_MS: z.coerce.number().default(5000),
});

function readDatabaseEnv() {
  return envSchema.parse(process.env);
}

@singleton()
export class DatabaseConfig {
  private readonly uri: string;
  private readonly maxRetries: number;
  private readonly retryInterval: number;

  constructor() {
    const env = readDatabaseEnv();
    this.uri = env.MONGODB_URI;
    this.maxRetries = env.DB_MAX_RETRIES;
    this.retryInterval = env.DB_RETRY_INTERVAL_MS;
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
      logger.info("Database connected", {
        event: "database.connected",
      });
      this.registerConnectionEvents();
    } catch (err: unknown) {
      logger.error("Database connection attempt failed", {
        event: "database.connection_failed",
        attempt,
        error: err,
      });
      if (attempt < this.maxRetries) {
        logger.info("Retrying database connection", {
          event: "database.connection_retry_scheduled",
          attempt,
          retryIntervalMs: this.retryInterval,
        });
        await new Promise((r) => setTimeout(r, this.retryInterval));
        return this.tryConnect(attempt + 1);
      } else {
        logger.error("Exceeded max DB connection attempts, exiting", {
          event: "database.connection_retries_exhausted",
          maxRetries: this.maxRetries,
        });
        process.exit(1);
      }
    }
  }

  public async connect(): Promise<void> {
    await this.tryConnect();
  }

  public async disconnect(): Promise<void> {
    await mongoose.disconnect();
    logger.info("Database disconnected", {
      event: "database.disconnected",
    });
  }

  // disconnects, errors, re-connects
  private registerConnectionEvents() {
    mongoose.connection.on("disconnected", () =>
      logger.warn("MongoDB disconnected", {
        event: "database.connection.disconnected",
      }),
    );
    mongoose.connection.on("reconnected", () =>
      logger.info("MongoDB reconnected", {
        event: "database.connection.reconnected",
      }),
    );
    mongoose.connection.on("error", (err) =>
      logger.error("MongoDB connection error", {
        event: "database.connection.error",
        error: err,
      }),
    );
  }

  // graceful shutdown
  private handleProcessSignals() {
    const shutdown = async (signal: NodeJS.Signals) => {
      logger.info("Database shutdown signal received", {
        event: "database.shutdown_signal",
        signal,
      });
      await this.disconnect();
      process.exit(0);
    };
    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((sig) =>
      process.on(sig, shutdown),
    );
  }
}
