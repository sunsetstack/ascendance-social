import { UserPublicId, asUserPublicId } from "@/types/branded";
import "reflect-metadata";
import { inject, injectable } from "tsyringe";
import mongoose from "mongoose";
import { RedisService } from "@/services/redis.service";
import { PostRepository } from "@/repositories/post.repository";
import { UserRepository } from "@/repositories/user.repository";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

interface ProfileSnapshotMessage {
  type: "avatar_changed" | "username_changed";
  userPublicId: UserPublicId;
  avatarUrl?: string;
  username?: string;
  handle?: string;
  timestamp: string;
}

/**
 * @class ProfileSyncWorker
 * Background worker responsible for propagating user profile changes (Avatar, Username)
 * to historical content.
 *
 * @architecture Eventual Consistency / Fan-out on Read
 * @problem Changing an avatar requires updating potentially thousands of old posts.
 * Doing this synchronously in the request handler would cause high latency.
 * @solution This worker listens for change events and performs bulk updates in the background.
 * It effectively decouples the "User Write" from the "System Consistency" overhead.
 */
@injectable()
export class ProfileSyncWorker {
  private running = false;

  // debounce multiple rapid changes from same user
  private pendingUpdates = new Map<
    string,
    { avatarUrl?: string; username?: string; handle?: string; lastSeen: number }
  >();
  private flushTimer?: NodeJS.Timeout;
  private FLUSH_INTERVAL_MS = 2000; // batch updates every 2 seconds

  constructor(
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
    @inject(TOKENS.Repositories.Post)
    private readonly postRepo: PostRepository,
    @inject(TOKENS.Repositories.User)
    private readonly userRepo: UserRepository,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;

    // subscribe to profile_snapshot_updates channel
    const subscribed =
      await this.redisService.subscribe<ProfileSnapshotMessage>(
        ["profile_snapshot_updates"],
        (channel, message) => {
          this.handleMessage(message).catch((err) => {
            logger.error("[profile-sync] error handling message", {
              error: err,
            });
          });
        },
        { timeoutMs: 1500 },
      );

    if (!subscribed) {
      logger.warn(
        "[profile-sync] worker not started because Redis is unavailable",
      );
      return;
    }

    this.running = true;

    // start flush timer
    this.flushTimer = setInterval(() => {
      this.flushPendingUpdates().catch((err) => {
        logger.error("[profile-sync] flush error", { error: err });
      });
    }, this.FLUSH_INTERVAL_MS);

    logger.info(
      "[profile-sync] worker started, listening on profile_snapshot_updates channel",
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    // flush any remaining updates
    await this.flushPendingUpdates();
    logger.info("[profile-sync] worker stopped");
  }

  /**
   * Handles incoming profile change events with In-Memory Debouncing.
   *
   * @pattern Debounce / Coalescing
   * @why If a user updates their profile 5 times in 1 second it shouldn't run
   * 5 heavy database updates. Store the latest state in a Map and
   * only flush to MongoDB once per interval.
   *
   * @param message - The raw Pub/Sub message containing the userPublicId and changed fields.
   * @returns {Promise<void>}
   */
  private async handleMessage(message: ProfileSnapshotMessage): Promise<void> {
    const { type, userPublicId, avatarUrl, username, handle } = message;

    logger.info(`[profile-sync] received ${type} for user ${userPublicId}`);

    // coalesce updates for same user
    const existing = this.pendingUpdates.get(userPublicId) ?? {
      lastSeen: Date.now(),
    };

    if (type === "avatar_changed" && avatarUrl !== undefined) {
      existing.avatarUrl = avatarUrl;
    }
    if (type === "username_changed" && username !== undefined) {
      existing.username = username;
    }
    if (handle !== undefined) {
      existing.handle = handle;
    }
    existing.lastSeen = Date.now();

    this.pendingUpdates.set(userPublicId, existing);
  }

  /**
   * Executes the bulk update against MongoDB.
   *
   * @optimization Batch Processing
   * @strategy Flushes all pending updates in one loop to minimize database connection
   * overhead and index thrashing.
   *
   * @returns {Promise<void>} Resolves when the batch update is complete.
   */
  private async flushPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) return;

    const entries = Array.from(this.pendingUpdates.entries());
    this.pendingUpdates.clear();

    logger.info(
      `[profile-sync] flushing ${entries.length} pending profile updates`,
    );

    for (const [userPublicId, updates] of entries) {
      try {
        // find user's ObjectId from publicId
        const user = await this.userRepo.findByPublicId(
          asUserPublicId(userPublicId),
        );
        if (!user) {
          logger.warn(`[profile-sync] user not found: ${userPublicId}`);
          continue;
        }

        const userObjectId = new mongoose.Types.ObjectId(user.id);

        const snapshotUpdates: {
          username?: string;
          avatarUrl?: string;
          handle?: string;
        } = {};

        if (updates.avatarUrl !== undefined) {
          snapshotUpdates.avatarUrl = updates.avatarUrl;
        }
        if (updates.username !== undefined) {
          snapshotUpdates.username = updates.username;
        }
        if (updates.handle !== undefined) {
          snapshotUpdates.handle = updates.handle;
        }

        if (Object.keys(snapshotUpdates).length === 0) {
          continue;
        }

        const modifiedCount = await this.postRepo.updateAuthorSnapshot(
          userObjectId,
          snapshotUpdates,
        );

        logger.info(
          `[profile-sync] updated ${modifiedCount} posts for user ${userPublicId}:`,
          {
            updates: snapshotUpdates,
          },
        );
      } catch (error) {
        logger.error(
          `[profile-sync] failed to update posts for user ${userPublicId}:`,
          { error },
        );
      }
    }
  }
}
