import { RedisClientType } from "redis";
import type { StreamMessagesNullReply, StreamMessageReply } from "@redis/client/dist/lib/commands/generic-transformers";

/** Shape of each entry returned by `xPendingRange`. Derived from the client library. */
export type XPendingRangeEntry = Awaited<
  ReturnType<RedisClientType["xPendingRange"]>
>[number];

/** The concrete return type of `xClaim`: an array of stream messages, with null slots for missed IDs. */
export type XClaimReply = StreamMessagesNullReply;

/** A non-null entry from an xClaim result. */
export type XClaimEntry = StreamMessageReply;

export class RedisStreamModule {
  constructor(private readonly client: RedisClientType) {}

  async pushToStream(
    stream = "stream:interactions",
    payload: Record<string, unknown>,
  ): Promise<string> {
    const prepared: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload)) {
      prepared[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return await this.client.xAdd(stream, "*", prepared);
  }

  async createStreamConsumerGroup(
    stream = "stream:interactions",
    group = "trendingGroup",
  ): Promise<void> {
    try {
      await this.client.xGroupCreate(stream, group, "$", { MKSTREAM: true });
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (!msg.includes("BUSYGROUP")) {
        throw err;
      }
    }
  }

  async ackStreamMessages(
    stream: string,
    group: string,
    ...ids: string[]
  ): Promise<number> {
    return await this.client.xAck(stream, group, ids);
  }

  async xPendingRange(
    stream: string,
    group: string,
    start = "-",
    end = "+",
    count = 1000,
  ): Promise<XPendingRangeEntry[]> {
    return await this.client.xPendingRange(stream, group, start, end, count);
  }

  async xClaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleMs: number,
    ids: string[],
  ): Promise<XClaimReply> {
    return await this.client.xClaim(stream, group, consumer, minIdleMs, ids);
  }
}
