import fs from "fs";
import { createClient, RedisClientType } from "redis";
import { MetricsService } from "@/metrics/metrics.service";
import { getErrorMessage } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";
import { RedisResilienceModule } from "./redis-resilience.module";

const DEFAULT_CONNECTION_WAIT_MS = 5000;

type RedisClientFactory = (redisUrl: string) => RedisClientType;

function redactRedisUrl(redisUrl: string): string {
  try {
    const parsed = new URL(redisUrl);
    if (parsed.username) {
      parsed.username = "***";
    }
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return redisUrl.includes("@") ? "redis://***" : redisUrl;
  }
}

export class RedisConnectionModule {
  private readonly client: RedisClientType;

  constructor(
    private readonly metricsService: MetricsService,
    private readonly resilienceModule: RedisResilienceModule,
    clientFactory: RedisClientFactory = (redisUrl) => createClient({ url: redisUrl }),
  ) {
    const runningInDocker = fs.existsSync("/.dockerenv");
    const redisUrl =
      process.env.REDIS_URL ||
      (runningInDocker
        ? "redis://redis-service:6379"
        : "redis://127.0.0.1:6379");
    const logSafeRedisUrl = redactRedisUrl(redisUrl);

    this.metricsService.setRedisConnectionState(false);
    this.client = clientFactory(redisUrl);

    this.client.on("connect", () => {
      redisLogger.info("Redis connected", { url: logSafeRedisUrl });
      this.metricsService.setRedisConnectionState(true);
    });
    this.client.on("error", (err) => {
      redisLogger.error("Redis client error", {
        error: err.message,
        stack: err.stack,
      });
      this.metricsService.setRedisConnectionState(false);
    });
    this.client.on("end", () => {
      this.metricsService.setRedisConnectionState(false);
    });
  }

  get clientInstance(): RedisClientType {
    return this.client;
  }

  start(): void {
    if (
      process.env.NODE_ENV !== "test" ||
      process.env.REDIS_AUTOCONNECT === "true"
    ) {
      void this.connect();
    }
  }

  async createDedicatedClient(): Promise<RedisClientType> {
    const client = this.client.duplicate();
    await client.connect();
    return client;
  }

  async waitForConnection(timeoutMs?: number): Promise<boolean> {
    if (this.client.isOpen) return true;

    return new Promise((resolve) => {
      if (this.client.isOpen) {
        resolve(true);
        return;
      }

      let settled = false;
      let timeout: NodeJS.Timeout | undefined;

      const cleanup = () => {
        this.client.off("connect", onConnect);
        this.client.off("error", onError);
        if (timeout) {
          clearTimeout(timeout);
        }
      };

      const settle = (connected: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(connected);
      };

      const onConnect = () => settle(true);
      const onError = (error: unknown) => {
        if (!this.resilienceModule.isRetryableRedisError(error)) {
          settle(false);
        }
      };

      this.client.once("connect", onConnect);
      this.client.once("error", onError);

      timeout = setTimeout(
        () => settle(this.client.isOpen),
        Math.max(timeoutMs ?? DEFAULT_CONNECTION_WAIT_MS, 0),
      );
    });
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
      redisLogger.info("Redis client connection established");
    } catch (error) {
      redisLogger.error("Redis connection failed", {
        error: getErrorMessage(error) || String(error),
      });
      this.metricsService.setRedisConnectionState(false);
    }
  }
}
