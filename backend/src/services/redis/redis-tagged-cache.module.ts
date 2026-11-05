import { performance } from "perf_hooks";
import { RedisClientType } from "redis";
import { redisLogger } from "@/utils/winston";
import { RedisJsonCacheModule } from "./redis-json-cache.module";
import { RedisResilienceModule } from "./redis-resilience.module";

type RedisScanResult = {
  cursor: number;
  keys: string[];
};

export type TaggedCacheEntry<T> = {
  key: string;
  value: T;
  tags: string[];
};

const INVALIDATE_TAGS_SCRIPT = `
local function members(key)
  if redis.call("TYPE", key).ok == "set" then
    return redis.call("SMEMBERS", key)
  end
  return {}
end

local keys = {}
for _, tagKey in ipairs(KEYS) do
  for _, key in ipairs(members(tagKey)) do
    keys[key] = true
  end
end

local count = 0
for key in pairs(keys) do
  local keyTags = "key_tags:" .. key
  for _, tag in ipairs(members(keyTags)) do
    local tagKey = "tag:" .. tag
    if redis.call("TYPE", tagKey).ok == "set" then
      redis.call("SREM", tagKey, key)
    end
  end
  redis.call("DEL", key, keyTags)
  count = count + 1
end
for _, tagKey in ipairs(KEYS) do
  redis.call("DEL", tagKey)
end
return count
`;

const REMOVE_INVALID_SET_KEYS_SCRIPT = `
local count = 0
for _, key in ipairs(KEYS) do
  if redis.call("TYPE", key).ok ~= "set" then
    count = count + redis.call("DEL", key)
  end
end
return count
`;

export class RedisTaggedCacheModule {
  constructor(
    private readonly client: RedisClientType,
    private readonly cacheModule: RedisJsonCacheModule,
    private readonly resilienceModule: RedisResilienceModule,
  ) {}

  async setWithTags<T>(
    key: string,
    value: T,
    tags: string[],
    ttl?: number,
  ): Promise<void> {
    if (tags.length === 0) {
      await this.cacheModule.set(key, value, ttl);
      return;
    }

    return this.resilienceModule.withResilience(
      async () => {
        const uniqueTags = [...new Set(tags)];
        const stringValue = JSON.stringify(value);
        const start = performance.now();

        if (ttl !== undefined && ttl <= 0) {
          const pipeline = this.client.multi();
          pipeline.del(key);
          pipeline.del(`key_tags:${key}`);
          for (const tag of uniqueTags) {
            pipeline.sRem(`tag:${tag}`, key);
          }
          await pipeline.exec();
          return;
        }

        await this.client.eval(REMOVE_INVALID_SET_KEYS_SCRIPT, {
          keys: [...uniqueTags.map((tag) => `tag:${tag}`), `key_tags:${key}`],
        });

        const pipeline = this.client.multi();

        if (ttl !== undefined) {
          pipeline.setEx(key, ttl, stringValue);
        } else {
          pipeline.set(key, stringValue);
        }

        for (const tag of uniqueTags) {
          const tagKey = `tag:${tag}`;
          pipeline.sAdd(tagKey, key);
          if (ttl !== undefined) {
            pipeline.expire(tagKey, ttl, "NX");
            pipeline.expire(tagKey, ttl, "GT");
          } else {
            pipeline.persist(tagKey);
          }
        }

        const keyTagKey = `key_tags:${key}`;
        for (const tag of uniqueTags) {
          pipeline.sAdd(keyTagKey, tag);
        }
        if (ttl !== undefined) {
          pipeline.expire(keyTagKey, ttl);
        } else {
          pipeline.persist(keyTagKey);
        }

        await pipeline.exec();
        const durationMs = performance.now() - start;
        redisLogger.info(
          `[Redis] setWithTags key=${key} tags=${uniqueTags.length} duration=${durationMs.toFixed(2)}ms`,
        );
      },
      { maxAttempts: 3 },
    );
  }

  async setManyWithTags<T>(
    entries: Array<TaggedCacheEntry<T>>,
    ttl?: number,
  ): Promise<void> {
    if (entries.length === 0) return;

    return this.resilienceModule.withResilience(
      async () => {
        const normalizedEntries = entries.map((entry) => ({
          ...entry,
          tags: [...new Set(entry.tags)],
        }));
        const setKeysToEnsure = new Set<string>();

        if (ttl !== undefined && ttl <= 0) {
          const pipeline = this.client.multi();
          for (const entry of normalizedEntries) {
            pipeline.del(entry.key);
            pipeline.del(`key_tags:${entry.key}`);
            for (const tag of entry.tags) {
              pipeline.sRem(`tag:${tag}`, entry.key);
            }
          }
          await pipeline.exec();
          return;
        }

        for (const entry of normalizedEntries) {
          if (entry.tags.length === 0) {
            continue;
          }

          setKeysToEnsure.add(`key_tags:${entry.key}`);
          for (const tag of entry.tags) {
            setKeysToEnsure.add(`tag:${tag}`);
          }
        }

        if (setKeysToEnsure.size > 0) {
          await this.client.eval(REMOVE_INVALID_SET_KEYS_SCRIPT, {
            keys: [...setKeysToEnsure],
          });
        }

        const start = performance.now();
        const pipeline = this.client.multi();

        for (const entry of normalizedEntries) {
          const stringValue = JSON.stringify(entry.value);

          if (ttl !== undefined) {
            pipeline.setEx(entry.key, ttl, stringValue);
          } else {
            pipeline.set(entry.key, stringValue);
          }

          if (entry.tags.length === 0) {
            continue;
          }

          const keyTagKey = `key_tags:${entry.key}`;
          for (const tag of entry.tags) {
            const tagKey = `tag:${tag}`;
            pipeline.sAdd(tagKey, entry.key);
            if (ttl !== undefined) {
              pipeline.expire(tagKey, ttl, "NX");
              pipeline.expire(tagKey, ttl, "GT");
            } else {
              pipeline.persist(tagKey);
            }
            pipeline.sAdd(keyTagKey, tag);
          }
          if (ttl !== undefined) {
            pipeline.expire(keyTagKey, ttl);
          } else {
            pipeline.persist(keyTagKey);
          }
        }

        await pipeline.exec();
        const durationMs = performance.now() - start;
        redisLogger.info(
          `[Redis] setManyWithTags keys=${normalizedEntries.length} duration=${durationMs.toFixed(2)}ms`,
        );
      },
      { maxAttempts: 3 },
    );
  }

  async invalidateByTags(tags: string[]): Promise<void> {
    if (tags.length === 0) return;

    return this.resilienceModule.withResilience(
      async () => {
        const uniqueTags = [...new Set(tags)];
        const start = performance.now();

        const count = await this.client.eval(INVALIDATE_TAGS_SCRIPT, {
          keys: uniqueTags.map((tag) => `tag:${tag}`),
        });

        const durationMs = performance.now() - start;
        redisLogger.info(
          `[Redis] invalidateByTags tags=${uniqueTags.length} keys=${count} duration=${durationMs.toFixed(2)}ms`,
        );
      },
      { maxAttempts: 3 },
    );
  }

  async getWithTags<T>(key: string): Promise<T | null> {
    return await this.cacheModule.get<T>(key);
  }

  async cleanupOrphanedTags(): Promise<void> {
    let cursor = 0;
    let cleaned = 0;

    do {
      const result = await this.scanKeys(cursor, "tag:*", 100);

      cursor = result.cursor;

      if (result.keys.length > 0) {
        cleaned += Number(await this.client.eval(REMOVE_INVALID_SET_KEYS_SCRIPT, {
          keys: result.keys,
        }));
      }
    } while (cursor !== 0);

    redisLogger.info(`[Redis] Cleaned ${cleaned} invalid tag keys`);
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
