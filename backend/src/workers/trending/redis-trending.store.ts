import { inject, injectable } from "tsyringe";
import { RedisService } from "@/services/redis.service";
import { TOKENS } from "@/types/tokens";
import type {
  ITrendingCacheStore,
  ITrendingStreamStore,
  TrendingProjectionUpdate,
  TrendingStreamClient,
  TrendingStreamConfig,
} from "./trending.ports";

type ReadGroupClient = TrendingStreamClient & {
  xReadGroup(
    group: string,
    consumer: string,
    stream: { key: string; id: string },
    options: { COUNT: number; BLOCK: number },
  ): Promise<unknown>;
};

@injectable()
export class RedisTrendingStreamStore implements ITrendingStreamStore {
  constructor(
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  async waitForConnection(timeoutMs: number): Promise<boolean> {
    return this.redisService.waitForConnection(timeoutMs);
  }

  async ensureConsumerGroup(stream: string, group: string): Promise<void> {
    await this.redisService.createStreamConsumerGroup(stream, group);
  }

  async createClient(): Promise<TrendingStreamClient> {
    return this.redisService.createDedicatedClient();
  }

  async closeClient(client: TrendingStreamClient): Promise<void> {
    await client.quit();
  }

  async readGroup(
    client: TrendingStreamClient,
    config: TrendingStreamConfig,
  ): Promise<unknown> {
    return (client as ReadGroupClient).xReadGroup(
      config.group,
      config.consumer,
      { key: config.stream, id: ">" },
      { COUNT: config.readCount, BLOCK: 5_000 },
    );
  }

  async acknowledge(
    stream: string,
    group: string,
    ids: readonly string[],
  ): Promise<void> {
    await this.redisService.ackStreamMessages(stream, group, ...ids);
  }

  async pendingRange(
    stream: string,
    group: string,
    count: number,
  ): Promise<unknown> {
    return this.redisService.xPendingRange(stream, group, "-", "+", count);
  }

  async claim(
    config: TrendingStreamConfig,
    ids: readonly string[],
  ): Promise<unknown> {
    return this.redisService.xClaim(
      config.stream,
      config.group,
      config.consumer,
      config.reclaimMinIdleMs,
      [...ids],
    );
  }
}

@injectable()
export class RedisTrendingCacheStore implements ITrendingCacheStore {
  constructor(
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  async writeUpdates(
    updates: readonly TrendingProjectionUpdate[],
  ): Promise<void> {
    await Promise.all(
      updates.flatMap(({ comments, likes, postId, score, views }) => [
        this.redisService.updateTrendingScore(
          postId,
          score,
          "trending:posts",
        ),
        this.redisService.patchWithTags(
          `post_meta:${postId}`,
          {
            likes,
            commentsCount: comments,
            viewsCount: views,
            lastUpdated: Date.now(),
          },
          [
            `post_meta:${postId}`,
            `post_likes:${postId}`,
            `post_comments:${postId}`,
          ],
          300,
        ),
      ]),
    );
  }
}
