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

        await Promise.all([
          ...uniqueTags.map((tag) => this.ensureSetKey(`tag:${tag}`)),
          this.ensureSetKey(`key_tags:${key}`),
        ]);

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

        await Promise.all(
          [...setKeysToEnsure].map((keyToEnsure) =>
            this.ensureSetKey(keyToEnsure),
          ),
        );

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

        const fetchPipeline = this.client.multi();
        for (const tag of uniqueTags) {
          fetchPipeline.sMembers(`tag:${tag}`);
        }
        const tagResults = await fetchPipeline.exec();

        const keysToDelete = new Set<string>();
        const tagKeysToDelete: string[] = [];
        const requestedTags = new Set(uniqueTags);

        uniqueTags.forEach((tag, idx) => {
          const tagKey = `tag:${tag}`;
          tagKeysToDelete.push(tagKey);
          const membersResult = tagResults?.[idx];
          if (Array.isArray(membersResult)) {
            for (const member of membersResult) {
              if (typeof member === "string") {
                keysToDelete.add(member);
              }
            }
          }
        });

        const keys = [...keysToDelete];
        const keyTagsPipeline = this.client.multi();
        for (const key of keys) {
          keyTagsPipeline.sMembers(`key_tags:${key}`);
        }
        const keyTagResults =
          keys.length > 0 ? await keyTagsPipeline.exec() : [];

        const deletePipeline = this.client.multi();
        let commandCount = 0;

        keys.forEach((key, idx) => {
          const keyTags = keyTagResults?.[idx];
          if (Array.isArray(keyTags)) {
            for (const tag of keyTags) {
              if (typeof tag === "string" && !requestedTags.has(tag)) {
                deletePipeline.sRem(`tag:${tag}`, key);
                commandCount++;
              }
            }
          }

          deletePipeline.del(key);
          deletePipeline.del(`key_tags:${key}`);
          commandCount += 2;
        });

        for (const tagKey of tagKeysToDelete) {
          deletePipeline.del(tagKey);
          commandCount++;
        }

        if (commandCount > 0) {
          await deletePipeline.exec();
        }

        const durationMs = performance.now() - start;
        redisLogger.info(
          `[Redis] invalidateByTags tags=${uniqueTags.length} keys=${keysToDelete.size} commands=${commandCount} duration=${durationMs.toFixed(2)}ms`,
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

      if (result.keys.length === 0) {
        continue;
      }

      const countPipeline = this.client.multi();
      for (const tagKey of result.keys) {
        countPipeline.sCard(tagKey);
      }
      const counts = await countPipeline.exec();

      const emptyTagKeys: string[] = [];
      result.keys.forEach((tagKey, idx) => {
        const count = Number(counts?.[idx] ?? 0);
        if (count === 0) {
          emptyTagKeys.push(tagKey);
        }
      });

      if (emptyTagKeys.length > 0) {
        await this.client.del(emptyTagKeys);
        cleaned += emptyTagKeys.length;
      }
    } while (cursor !== 0);

    redisLogger.info(`[Redis] Cleaned ${cleaned} empty tag sets`);
  }

  private async ensureSetKey(key: string): Promise<void> {
    const type = await this.client.type(key);
    if (type !== "none" && type !== "set") {
      await this.client.del(key);
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
