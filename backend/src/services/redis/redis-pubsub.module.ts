import { RedisClientType } from "redis";
import { getErrorMessage } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";
import { RedisConnectionModule } from "./redis-connection.module";
import { RedisResilienceModule } from "./redis-resilience.module";

export type RedisSubscribeOptions = {
  timeoutMs?: number;
};

export class RedisPubSubModule {
  private readonly subscribers = new Map<string, RedisClientType>();

  constructor(
    private readonly client: RedisClientType,
    private readonly connectionModule: RedisConnectionModule,
    private readonly resilienceModule: RedisResilienceModule,
  ) {}

  async publish<T>(channel: string, message: T): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe<T>(
    channels: string[],
    messageHandler: (channel: string, message: T) => void,
    options?: RedisSubscribeOptions,
  ): Promise<boolean> {
    const ready = await this.connectionModule.waitForConnection(
      options?.timeoutMs,
    );
    if (!ready) {
      redisLogger.warn("Redis unavailable, skipping subscription", {
        channels,
      });
      return false;
    }

    const subscriberKey = [...channels].sort().join(",");
    const existing = this.subscribers.get(subscriberKey);
    if (existing?.isOpen) {
      try {
        await existing.unsubscribe();
        await existing.quit();
      } catch {
        // best-effort cleanup before replacing the subscriber
      }
    }

    const subscriber = this.client.duplicate();
    try {
      await subscriber.connect();
      this.subscribers.set(subscriberKey, subscriber);

      await subscriber.subscribe(channels, (message, channel) => {
        try {
          const parsedMessage = this.parseJson<T>(message);
          messageHandler(channel, parsedMessage);
        } catch (error) {
          redisLogger.error("Error parsing Redis message", {
            channel,
            error: getErrorMessage(error) || String(error),
          });
        }
      });
      return true;
    } catch (error) {
      if (subscriber.isOpen) {
        try {
          await subscriber.quit();
        } catch {
          // ignore cleanup failures during degraded startup
        }
      }

      if (this.resilienceModule.isRetryableRedisError(error)) {
        redisLogger.warn("Redis unavailable, subscription not started", {
          channels,
          error: getErrorMessage(error) || String(error),
        });
        return false;
      }

      throw error;
    }
  }

  async unsubscribeAll(): Promise<void> {
    for (const [key, subscriber] of this.subscribers) {
      try {
        if (subscriber.isOpen) {
          await subscriber.unsubscribe();
          await subscriber.quit();
        }
      } catch (error) {
        redisLogger.error(`Failed to close subscriber for ${key}`, {
          error: getErrorMessage(error),
        });
      }
    }
    this.subscribers.clear();
  }

  private parseJson<T>(payload: string): T {
    return JSON.parse(payload) as T;
  }
}
