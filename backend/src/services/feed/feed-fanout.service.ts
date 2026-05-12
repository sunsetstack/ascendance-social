import { inject, injectable } from "tsyringe";
import { FollowRepository } from "@/repositories/follow.repository";
import { PostRepository } from "@/repositories/post.repository";
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
    @inject(TOKENS.Repositories.Post) private postRepository: PostRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
  ) {}

  public async fanOutPostToFollowers(
    postId: string,
    authorId: string,
    timestamp: number,
  ): Promise<void> {
    logger.info(
      `Fanning out post ${postId} from author ${authorId} to followers`,
    );

    try {
      const followerIds =
        await this.followRepository.getFollowerPublicIdsByPublicId(authorId);
      if (followerIds.length === 0) {
        logger.info(
          `No followers found for author ${authorId}, skipping fan-out`,
        );
        return;
      }

      await this.redisService.addToFeedsBatch(
        followerIds,
        postId,
        timestamp,
        "for_you",
      );
      logger.info(
        `Fanned out post ${postId} to ${followerIds.length} followers`,
      );
    } catch (error) {
      logger.error(`Failed to fan out post ${postId}:`, error);
    }
  }

  public async removePostFromFollowers(
    postId: string,
    authorId: string,
  ): Promise<void> {
    logger.info(`Removing post ${postId} from followers of ${authorId}`);

    try {
      const followerIds =
        await this.followRepository.getFollowerPublicIdsByPublicId(authorId);
      if (followerIds.length === 0) return;

      await this.redisService.removeFromFeedsBatch(
        followerIds,
        postId,
        "for_you",
      );
      logger.info(
        `Removed post ${postId} from ${followerIds.length} followers' feeds`,
      );
    } catch (error) {
      logger.error(`Failed to remove post ${postId} from feeds:`, error);
    }
  }

  public async prewarmNewFeed(): Promise<void> {
    logger.info("Pre-warming New feed cache...");
    try {
      const limit = 20;
      let cursor: string | undefined;
      for (let page = 1; page <= 3; page++) {
        const key = CacheKeyBuilder.getNewFeedKey(page, limit);
        const cursorResult = await this.feedReadDao.getNewFeedWithCursor({
          limit,
          cursor,
        });
        const core: CoreFeed = {
          data: cursorResult.data as FeedPost[],
          limit,
          page,
          total: 0,
          totalPages: 0,
          hasMore: cursorResult.hasMore,
          nextCursor: cursorResult.nextCursor,
          prevCursor: cursorResult.prevCursor,
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
