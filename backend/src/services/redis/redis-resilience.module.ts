import { getErrorMessage } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";

export interface ResilienceConfigBase {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

interface ResilienceConfigWithFallback<T> extends ResilienceConfigBase {
  fallbackValue: T;
}

export type ResilienceConfig<T> =
  | ResilienceConfigBase
  | ResilienceConfigWithFallback<T>;

const DEFAULT_RESILIENCE: Required<ResilienceConfigBase> = {
  maxAttempts: 3,
  baseDelayMs: 50,
  maxDelayMs: 1000,
};

export class RedisResilienceModule {
  async withResilience<T>(
    operation: () => Promise<T>,
    config?: ResilienceConfig<T>,
  ): Promise<T> {
    const cfg = { ...DEFAULT_RESILIENCE, ...config };
    const maxAttempts = Math.max(1, Math.floor(cfg.maxAttempts));
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        const message = getErrorMessage(error) || String(error);
        lastError = error instanceof Error ? error : new Error(message);

        if (!this.isRetryableRedisError(error) || attempt >= maxAttempts) {
          if (this.hasFallback(config)) {
            redisLogger.warn("Redis operation failed, using fallback", {
              error: lastError.message,
              attempt,
            });
            return config.fallbackValue;
          }
          throw error;
        }

        redisLogger.warn("Redis operation failed, retrying", {
          error: lastError.message,
          attempt,
          maxAttempts,
        });

        await this.backoffWithJitter(attempt, cfg.baseDelayMs, cfg.maxDelayMs);
      }
    }

    if (this.hasFallback(config)) {
      return config.fallbackValue;
    }
    throw lastError;
  }

  isRetryableRedisError(error: unknown): boolean {
    const message = getErrorMessage(error).toLowerCase();
    if (!message) return false;

    const retryablePatterns = [
      "econnreset",
      "econnrefused",
      "etimedout",
      "socket closed",
      "connection",
      "network",
      "busy",
      "loading",
    ];
    return retryablePatterns.some((p) => message.includes(p));
  }

  private hasFallback<T>(
    config?: ResilienceConfig<T>,
  ): config is ResilienceConfigWithFallback<T> {
    return config !== undefined && "fallbackValue" in config;
  }

  private async backoffWithJitter(
    attempt: number,
    baseMs: number,
    maxMs: number,
  ): Promise<void> {
    const exponentialDelay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    const jitteredDelay = Math.floor(Math.random() * exponentialDelay);
    return new Promise((resolve) =>
      setTimeout(resolve, Math.max(jitteredDelay, 10)),
    );
  }
}
