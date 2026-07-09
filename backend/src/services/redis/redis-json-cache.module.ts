import { RedisClientType } from "redis";
import { getErrorMessage } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";

type RedisScanResult = {
  cursor: number;
  keys: string[];
};

export class RedisJsonCacheModule {
  constructor(private readonly client: RedisClientType) {}

  async getValidated<T>(
    key: string,
    guard: (v: unknown) => v is T,
  ): Promise<T | null> {
    const parsed = await this.get<unknown>(key);
    if (parsed === null) return null;
    return guard(parsed) ? parsed : null;
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(key);
    return data !== null ? this.parseCachedValue<T>(key, data) : null;
  }

  async mGet<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const values = await this.client.mGet(keys);
    return values.map((value, index) =>
      value !== null ? this.parseCachedValue<T>(keys[index], value) : null,
    );
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const stringValue = JSON.stringify(value);
    if (ttl !== undefined) {
      if (ttl <= 0) {
        await this.client.del(key);
        return;
      }
      await this.client.setEx(key, ttl, stringValue);
    } else {
      await this.client.set(key, stringValue);
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }

  async merge<T extends Record<string, unknown>>(
    key: string,
    value: Partial<T>,
    ttl?: number,
  ): Promise<void> {
    const existing = await this.get<T>(key);
    const next = existing ? { ...existing, ...value } : value;
    await this.set(key, next, ttl);
  }

  async del(keyPattern: string): Promise<number> {
    let cursor = 0;
    let deletedCount = 0;
    const batchSize = 100;

    do {
      const result = await this.scanKeys(cursor, keyPattern, batchSize);

      cursor = result.cursor;
      const keys = result.keys;

      if (keys.length > 0) {
        await this.client.del(keys);
        deletedCount += keys.length;
      }
    } while (cursor !== 0);

    redisLogger.info(
      `[Redis] Deleted ${deletedCount} keys matching pattern: ${keyPattern}`,
    );
    return deletedCount;
  }

  async deletePatterns(patterns: string[]): Promise<void> {
    await Promise.all(patterns.map((p) => this.del(p)));
  }

  private parseJson<T>(payload: string): T {
    return JSON.parse(payload) as T;
  }

  private parseCachedValue<T>(key: string, payload: string): T | null {
    try {
      return this.parseJson<T>(payload);
    } catch (error) {
      redisLogger.error("Redis cache value is not valid JSON", {
        key,
        error: getErrorMessage(error) || String(error),
      });
      return null;
    }
  }

  private async scanKeys(
    cursor: number,
    match: string,
    count: number,
  ): Promise<RedisScanResult> {
    const result = await this.client.scan(cursor, {
      MATCH: match,
      COUNT: count,
    });

    return {
      cursor:
        typeof result.cursor === "number"
          ? result.cursor
          : Number(result.cursor),
      keys: result.keys,
    };
  }
}
