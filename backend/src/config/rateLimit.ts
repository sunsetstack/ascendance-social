import fs from "node:fs";
import type {
  Options as RateLimitOptions,
  Store as RateLimitStore,
} from "express-rate-limit";
import { createClient, type RedisClientType } from "redis";
import { RedisStore } from "rate-limit-redis";
import { logger } from "@/utils/winston";

let rateLimitClient: RedisClientType | undefined;
let clientPromise: Promise<RedisClientType> | undefined;

function resolveRedisUrl(): string {
  const runningInDocker = fs.existsSync("/.dockerenv");
  return (
    process.env.REDIS_URL ||
    (runningInDocker ? "redis://redis-service:6379" : "redis://127.0.0.1:6379")
  );
}

function getRateLimitClient(): {
  client: RedisClientType;
  promise: Promise<RedisClientType>;
} {
  if (!rateLimitClient || !clientPromise) {
    rateLimitClient = createClient({ url: resolveRedisUrl() });
    rateLimitClient.on("error", (error) => {
      logger.error("[RateLimit] Redis client error", {
        error: error.message,
        stack: error.stack,
      });
    });

    clientPromise = rateLimitClient
      .connect()
      .then(() => rateLimitClient!)
      .catch((err) => {
        logger.error("[RateLimit] Failed to connect Redis client", {
          error: err instanceof Error ? err.message : String(err),
        });
        // allow retry on next command
        clientPromise = undefined;
        throw err;
      });
  }

  return { client: rateLimitClient, promise: clientPromise };
}

class LazyRedisStore implements RateLimitStore {
  readonly localKeys = false;
  readonly prefix: string;

  private innerStore: RedisStore | undefined;
  private innerStorePromise: Promise<RedisStore> | undefined;
  private initOptions: RateLimitOptions | undefined;

  constructor(prefix: string) {
    this.prefix = `rate-limit:${prefix}:`;
  }

  init(options: RateLimitOptions): void {
    this.initOptions = options;
    this.innerStore?.init(options);
  }

  async get(key: string) {
    return (await this.getInnerStore()).get(key);
  }

  async increment(key: string) {
    return (await this.getInnerStore()).increment(key);
  }

  async decrement(key: string) {
    await (await this.getInnerStore()).decrement(key);
  }

  async resetKey(key: string) {
    await (await this.getInnerStore()).resetKey(key);
  }

  private async getInnerStore(): Promise<RedisStore> {
    if (this.innerStore) {
      return this.innerStore;
    }

    if (!this.innerStorePromise) {
      this.innerStorePromise = Promise.resolve()
        .then(() => {
          const store = new RedisStore({
            prefix: this.prefix,
            sendCommand: async (...args: string[]) => {
              const { client, promise } = getRateLimitClient();
              if (promise) await promise;
              return client.sendCommand(args);
            },
          });

          if (this.initOptions) {
            store.init(this.initOptions);
          }

          this.innerStore = store;
          return store;
        })
        .catch((error) => {
          this.innerStorePromise = undefined;
          throw error;
        });
    }

    return this.innerStorePromise;
  }
}

function makeRateLimitStore(prefix: string): RateLimitStore | undefined {
  if (process.env.NODE_ENV === "test") {
    return undefined;
  }

  return new LazyRedisStore(prefix);
}

export function getRateLimitStoreOptions(
  prefix: string,
  options: { passOnStoreError?: boolean } = {},
):
  | {
      store: RateLimitStore;
      passOnStoreError: boolean;
      validate: { unsharedStore: false };
    }
  | {} {
  const store = makeRateLimitStore(prefix);
  return store
    ? {
        store,
        passOnStoreError: options.passOnStoreError ?? true,
        validate: { unsharedStore: false },
      }
    : {};
}
