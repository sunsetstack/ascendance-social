import { asUserPublicId } from "@/types/branded";
import { injectable, inject } from "tsyringe";

import { FollowRepository } from "@/repositories/follow.repository";
import { RedisService } from "../redis.service";
import { logger } from "@/utils/winston";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { CoreFeed, FeedPost } from "@/types";
import { TOKENS } from "@/types/tokens";
import type { IFeedReadDao } from "@/repositories/interfaces";

@injectable()
export class FeedFanoutService {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
  ) {}

  public async fanOutPostToFollowers(
    postId: string,
    authorId: string,
    timestamp: number,
  ): Promise<void> {
    logger.info("Feed fan-out started", {
      event: "feed.fanout.started",
      postId,
      authorId,
    });

    try {
      const followerIds =
        await this.followRepository.getFollowerPublicIdsByPublicId(
          asUserPublicId(authorId),
        );
      if (followerIds.length === 0) {
        logger.info("Feed fan-out skipped because author has no followers", {
          event: "feed.fanout.skipped_no_followers",
          postId,
          authorId,
        });
        return;
      }

      await this.redisService.addToFeedsBatch(
        followerIds,
        postId,
        timestamp,
        "for_you",
      );
      logger.info("Feed fan-out completed", {
        event: "feed.fanout.completed",
        postId,
        authorId,
        followerCount: followerIds.length,
      });
    } catch (error) {
      logger.error("Feed fan-out failed", {
        event: "feed.fanout.failed",
        postId,
        authorId,
        error,
      });
    }
  }

  public async removePostFromFollowers(
    postId: string,
    authorId: string,
  ): Promise<void> {
    logger.info("Feed fan-out removal started", {
      event: "feed.fanout_removal.started",
      postId,
      authorId,
    });

    try {
      const followerIds =
        await this.followRepository.getFollowerPublicIdsByPublicId(
          asUserPublicId(authorId),
        );
      if (followerIds.length === 0) {
        logger.info("Feed fan-out removal skipped because author has no followers", {
          event: "feed.fanout_removal.skipped_no_followers",
          postId,
          authorId,
        });
        return;
      }

      await this.redisService.removeFromFeedsBatch(
        followerIds,
        postId,
        "for_you",
      );
      logger.info("Feed fan-out removal completed", {
        event: "feed.fanout_removal.completed",
        postId,
        authorId,
        followerCount: followerIds.length,
      });
    } catch (error) {
      logger.error("Feed fan-out removal failed", {
        event: "feed.fanout_removal.failed",
        postId,
        authorId,
        error,
      });
    }
  }

  public async prewarmNewFeed(): Promise<void> {
    logger.info("Pre-warming New feed cache...");
    try {
      const limit = 20;
      let cursor: string | undefined;
      for (let page = 1; page <= 3; page++) {
        const requestCursor = cursor;
        const key = requestCursor
          ? CacheKeyBuilder.getNewFeedCursorKey(requestCursor, limit)
          : CacheKeyBuilder.getNewFeedKey(page, limit);
        const cursorResult = await this.feedReadDao.getNewFeedWithCursor({
          limit,
          cursor: requestCursor,
        });
        const core: CoreFeed & { headCursor?: string } = {
          data: cursorResult.data as FeedPost[],
          limit,
          page,
          total: 0,
          totalPages: 0,
          hasMore: cursorResult.hasMore,
          nextCursor: cursorResult.nextCursor,
          prevCursor: cursorResult.prevCursor,
          headCursor: cursorResult.prevCursor,
        };
        cursor = cursorResult.nextCursor;
        await this.redisService.setWithTags(
          key,
          core,
          [
            CacheKeyBuilder.getNewFeedTag(),
            CacheKeyBuilder.getFeedPageTag(page),
            CacheKeyBuilder.getFeedLimitTag(limit),
          ],
          3600,
        );
        logger.info(`Pre-warmed New feed page ${page}`);
        if (!cursorResult.nextCursor || !cursorResult.hasMore) {
          break;
        }
      }
      logger.info("New feed cache pre-warming complete");
    } catch (error) {
      logger.error("Failed to pre-warm New feed cache", { error });
    }
  }
}
