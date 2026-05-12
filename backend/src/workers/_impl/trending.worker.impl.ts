import "reflect-metadata";
import { container, inject, injectable } from "tsyringe";
import { performance } from "perf_hooks";
import type { RedisClientType } from "redis";
import { RedisService } from "@/services/redis.service";
import { PostRepository } from "@/repositories/post.repository";
import { FeedPost } from "@/types";
import { logger } from "@/utils/winston";
import type { IFeedReadDao } from "@/repositories/interfaces";
import { TOKENS } from "@/types/tokens";
import type {
  XPendingRangeEntry,
  XClaimEntry,
  XClaimReply,
} from "@/services/redis/redis-stream.module";

/** Handles trending feed updates and calculations
 * This worker uses a classic write-behind cache pattern. It runs the expensive mongo aggregation once
 * and updates the top 500(can be adjusted) posts in Redis sorted set
 * Stores post metadata in Redis cache
 * massively reducing database load and providing faster API responses for trending feed.
 * TRENDING_BATCH_MS=2000           # How often to process stream events (2s)
 * TRENDING_FULL_REFRESH_MS=300000  # How often to refresh all posts (5min)
 * TRENDING_READ_COUNT=100          # Stream batch size
 *
 * It periodically refreshes the trending feed while pre-computing everything in the background
 * allowing for the API to serve cached results with real-time updates via Redis Streams.
 *
 * It also falls back to Mongo if Redis is empty (graceful degradation)
 *
 * The point of this thing is to allow handling a high volume of concurrent users.
 * It can be replicated for other feeds.
 */

type PendingDeltas = {
  commentsDelta: number;
  likesDelta: number;
  lastSeen: number;
  messageIds: string[];
};

@injectable()
export class TrendingWorker {
  private STREAM = "stream:interactions";
  private GROUP = "trendingGroup";
  private CONSUMER = `trending-${process.env.HOSTNAME ?? "local"}-${process.pid}`;
  private BATCH_WINDOW_MS = Number(process.env.TRENDING_BATCH_MS) || 2000; // calc and update trend scores every 2 secs
  private READ_COUNT = Number(process.env.TRENDING_READ_COUNT) || 100;
  private RECLAIM_MIN_IDLE_MS =
    Number(process.env.TRENDING_RECLAIM_MS) || 60_000;
  private RECLAIM_INTERVAL_MS =
    Number(process.env.TRENDING_RECLAIM_INTERVAL_MS) || 30_000;
  private CHUNK_SIZE = 50;
  private FULL_REFRESH_INTERVAL_MS =
    Number(process.env.TRENDING_FULL_REFRESH_MS) || 300_000; // full refresh every 5 min

  private WEIGHTS = { recency: 0.4, popularity: 0.5, comments: 0.1 };

  private redisService!: RedisService;
  private redisClient!: RedisClientType; // only for xReadGroup use
  private postRepo!: PostRepository;

  private pending = new Map<string, PendingDeltas>();
  private flushing = false;
  private running = false;
  private flushTimer?: NodeJS.Timeout;
  private reclaimTimer?: NodeJS.Timeout;
  private fullRefreshTimer?: NodeJS.Timeout;

  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
  ) {}

  /** initialize dependencies and create consumer group if necessary */
  async init(): Promise<void> {
    this.redisService = container.resolve(RedisService);
    this.postRepo = container.resolve(PostRepository);

    // expose typed client instance for read operations (xReadGroup)
    this.redisClient = this.redisService.clientInstance;

    // ensure redis is connected before creating group or starting read loop
    await this.redisService.waitForConnection();

    // create group via helper (MKSTREAM)
    await this.redisService.createStreamConsumerGroup(this.STREAM, this.GROUP);
    logger.info(
      `[trending] ensured consumer group ${this.GROUP} on ${this.STREAM}`,
    );
  }

  /** start reading stream and flushing batches */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.readLoop().catch((err) => {
      logger.error("[trending] readLoop fatal error", { error: err });
    });

    this.flushTimer = setInterval(() => {
      this.flushPending().catch((err) =>
        logger.error("[trending] flushPending error", { error: err }),
      );
    }, this.BATCH_WINDOW_MS);

    this.reclaimTimer = setInterval(() => {
      this.reclaimStalledMessages().catch((err) =>
        logger.error("[trending] reclaim error", { error: err }),
      );
    }, this.RECLAIM_INTERVAL_MS);

    // periodically refresh entire trending feed to catch posts without recent interactions
    this.fullRefreshTimer = setInterval(() => {
      this.fullRefresh().catch((err) =>
        logger.error("[trending] full refresh error", { error: err }),
      );
    }, this.FULL_REFRESH_INTERVAL_MS);

    // run initial full refresh on startup
    this.fullRefresh().catch((err) =>
      logger.error("[trending] initial refresh error", { error: err }),
    );

    logger.info(`[trending] worker started (consumer=${this.CONSUMER})`);
  }

  /** stop reading and gracefully shutdown (flush pending) */
  async stop(): Promise<void> {
    this.running = false;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    if (this.fullRefreshTimer) clearInterval(this.fullRefreshTimer);

    await this.flushPending();
    logger.info("[trending] worker stopped");
  }

  /** main read loop that consumes stream messages using XREADGROUP via clientInstance */
  private async readLoop(): Promise<void> {
    while (this.running) {
      try {
        const responses = await this.redisClient.xReadGroup(
          this.GROUP,
          this.CONSUMER,
          { key: this.STREAM, id: ">" },
          { COUNT: this.READ_COUNT, BLOCK: 5_000 },
        );

        if (!responses) {
          continue;
        }

        for (const streamRes of responses) {
          for (const message of streamRes.messages) {
            this.handleStreamMessage(message.id, message.message).catch((err) =>
              logger.error("[trending] failed to stage stream message", {
                id: message.id,
                error: err,
              }),
            );
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;
        logger.error("[trending] readLoop error", {
          message: errorMessage,
          stack: errorStack,
        });
        await this.sleep(1000);
      }
    }
  }

  /** handle a single stream message: coalesce it for the next flush */
  private async handleStreamMessage(
    id: string,
    fields: Record<string, string>,
  ): Promise<void> {
    const postId = fields.postId ?? fields.postPublicId ?? fields.post;

    if (!postId) {
      logger.warn(`[trending] malformed message ${id} missing postId - acking`);
      await this.redisService.ackStreamMessages(this.STREAM, this.GROUP, id);
      return;
    }

    const now = Date.now();
    const existing = this.pending.get(postId) ?? {
      commentsDelta: 0,
      likesDelta: 0,
      lastSeen: now,
      messageIds: [],
    };
    existing.lastSeen = now;
    if (!existing.messageIds.includes(id)) {
      existing.messageIds.push(id);
    }
    this.pending.set(postId, existing);
  }

  private requeueEntries(entries: Array<[string, PendingDeltas]>): void {
    for (const [postId, entry] of entries) {
      const existing = this.pending.get(postId);
      if (!existing) {
        this.pending.set(postId, {
          ...entry,
          messageIds: [...entry.messageIds],
        });
        continue;
      }

      existing.lastSeen = Math.max(existing.lastSeen, entry.lastSeen);
      for (const messageId of entry.messageIds) {
        if (!existing.messageIds.includes(messageId)) {
          existing.messageIds.push(messageId);
        }
      }
      this.pending.set(postId, existing);
    }
  }

  /** Flush pending map: compute score per post and update ZSET via helper */
  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    if (this.pending.size === 0) return;
    this.flushing = true;
    const start = performance.now();

    try {
      const entries = Array.from(this.pending.entries());
      this.pending.clear();

      for (let i = 0; i < entries.length; i += this.CHUNK_SIZE) {
        const chunk = entries.slice(i, i + this.CHUNK_SIZE);
        try {
          const postIds = chunk.map(([postId]) => postId);

          const posts: FeedPost[] =
            await this.postRepo.findPostsByPublicIds(postIds);
          const postMap = new Map<string, FeedPost>();
          for (const p of posts) {
            postMap.set(p.publicId, p);
          }

          const updates: Promise<unknown>[] = [];
          const messageIdsToAck: string[] = [];

          for (const [postId, pendingEntry] of chunk) {
            messageIdsToAck.push(...pendingEntry.messageIds);
            const post = postMap.get(postId);
            if (!post) {
              logger.warn(
                `[trending] post ${postId} missing during flush; acknowledging pending messages`,
              );
              continue;
            }

            // use MongoDB as source of truth (it's already updated by like/comment handlers)
            const likes = post.likes || 0;
            const comments = post.commentsCount || 0;
            const views = post.viewsCount || 0;

            const ageDays =
              (Date.now() - new Date(post.createdAt).getTime()) /
              (1000 * 60 * 60 * 24);
            const recencyScore = 1 / (1 + ageDays);
            const popularityScore = Math.log(likes + 1);
            const commentsScore = Math.log(comments + 1);

            const score =
              this.WEIGHTS.recency * recencyScore +
              this.WEIGHTS.popularity * popularityScore +
              this.WEIGHTS.comments * commentsScore;

            logger.info(
              `[trending] ${postId}: likes=${likes}, comments=${comments}, age=${ageDays.toFixed(1)}d, ` +
                `recency=${recencyScore.toFixed(3)}, popularity=${popularityScore.toFixed(3)}, score=${score.toFixed(3)}`,
            );

            // update trending score in sorted set (use "trending:posts" key to match handler)
            updates.push(
              this.redisService.updateTrendingScore(
                postId,
                Number(score),
                "trending:posts",
              ),
            );

            // store computed counts in post_meta cache for handler enrichment
            const metaKey = `post_meta:${postId}`;
            const metaTags = [
              `post_meta:${postId}`,
              `post_likes:${postId}`,
              `post_comments:${postId}`,
            ];
            updates.push(
              this.redisService.setWithTags(
                metaKey,
                {
                  likes,
                  commentsCount: comments,
                  viewsCount: views,
                  lastUpdated: Date.now(),
                },
                metaTags,
                300, // 5 min TTL
              ),
            );
          }

          await Promise.all(updates);
          if (messageIdsToAck.length > 0) {
            await this.redisService.ackStreamMessages(
              this.STREAM,
              this.GROUP,
              ...messageIdsToAck,
            );
          }
        } catch (err) {
          this.requeueEntries(chunk);
          throw err;
        }
      }
    } catch (err) {
      logger.error("[trending] flushPending failed", { error: err });
    } finally {
      this.flushing = false;
      const dur = performance.now() - start;
      logger.info(`[trending] flushed updates (${dur.toFixed(1)}ms)`);
    }
  }

  /** reclaim messages that are pending (XPENDING) and idle for > RECLAIM_MIN_IDLE_MS using helpers */
  private async reclaimStalledMessages(): Promise<void> {
    try {
      const pendingSummary: XPendingRangeEntry[] =
        await this.redisService.xPendingRange(
          this.STREAM,
          this.GROUP,
          "-",
          "+",
          1000,
        );

      if (!pendingSummary || pendingSummary.length === 0) return;

      const toClaim: string[] = [];
      for (const item of pendingSummary) {
        if (item.millisecondsSinceLastDelivery >= this.RECLAIM_MIN_IDLE_MS) {
          toClaim.push(item.id);
        }
      }

      if (toClaim.length === 0) return;

      const claimResult: XClaimReply = await this.redisService.xClaim(
        this.STREAM,
        this.GROUP,
        this.CONSUMER,
        this.RECLAIM_MIN_IDLE_MS,
        toClaim,
      );

      // xClaim may return null for IDs that disappeared between XPENDING and XCLAIM
      const claimed = claimResult.filter(
        (msg): msg is XClaimEntry => msg !== null,
      );

      for (const msg of claimed) {
        try {
          await this.handleStreamMessage(String(msg.id), msg.message as Record<string, string>);
        } catch (err) {
          logger.error("[trending] error handling reclaimed message", {
            id: msg.id,
            error: err,
          });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      logger.error("[trending] reclaimStalledMessages failed", {
        message: errorMessage,
        stack: errorStack,
      });
    }
  }

  /**
   * Full refresh: recalculate scores for all posts in time window
   * This ensures posts without recent interactions still get ranked
   */
  private async fullRefresh(): Promise<void> {
    logger.info("[trending] starting full refresh...");
    const start = performance.now();

    try {
      // use the repository's trending feed aggregation to get candidate posts
      const timeWindowDays = 14;
      const limit = 500; // refresh top 500 posts
      const result = await this.feedReadDao.getTrendingFeedWithCursor({
        limit,
        timeWindowDays,
        minLikes: 0,
      });

      if (!result.data || result.data.length === 0) {
        logger.warn("[trending] no posts found for full refresh");
        return;
      }

      const updates: Promise<unknown>[] = [];

      for (const post of result.data) {
        const postId = post.publicId;
        const likes = post.likes || 0;
        const comments = post.commentsCount || 0;
        const views = post.viewsCount || 0;

        const ageDays =
          (Date.now() - new Date(post.createdAt).getTime()) /
          (1000 * 60 * 60 * 24);
        const recencyScore = 1 / (1 + ageDays);
        const popularityScore = Math.log(likes + 1);
        const commentsScore = Math.log(comments + 1);

        const score =
          this.WEIGHTS.recency * recencyScore +
          this.WEIGHTS.popularity * popularityScore +
          this.WEIGHTS.comments * commentsScore;

        // update sorted set and meta cache
        updates.push(
          this.redisService.updateTrendingScore(
            postId,
            Number(score),
            "trending:posts",
          ),
        );

        const metaKey = `post_meta:${postId}`;
        const metaTags = [
          `post_meta:${postId}`,
          `post_likes:${postId}`,
          `post_comments:${postId}`,
        ];
        updates.push(
          this.redisService.setWithTags(
            metaKey,
            {
              likes,
              commentsCount: comments,
              viewsCount: views,
              lastUpdated: Date.now(),
            },
            metaTags,
            300,
          ),
        );
      }

      await Promise.all(updates);

      const dur = performance.now() - start;
      logger.info(
        `[trending] full refresh completed: ${result.data.length} posts updated (${dur.toFixed(1)}ms)`,
      );
    } catch (err) {
      logger.error("[trending] full refresh failed", { error: err });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
