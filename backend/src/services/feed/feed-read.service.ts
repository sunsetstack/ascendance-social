import { inject, injectable } from "tsyringe";
import type { PostRepository } from "@/repositories/post.repository";
import type { RedisService } from "../redis.service";
import type { DTOService } from "../dto.service";
import type { FeedEnrichmentService } from "./feed-enrichment.service";
import type { FeedCoreService } from "./feed-core.service";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { CacheConfig } from "@/config/cacheConfig";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { CoreFeed, FeedPost, PaginationResult, PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";
import type { IFeedReadDao } from "@/repositories/interfaces";

@injectable()
export class FeedReadService {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.Post) private postRepository: PostRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Services.FeedEnrichment)
    private readonly feedEnrichmentService: FeedEnrichmentService,
    @inject(TOKENS.Services.FeedCore)
    private readonly feedCoreService: FeedCoreService,
  ) {}

  public async getPersonalizedFeed(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    logger.info(
      `Running partitioned getPersonalizedFeed for userId: ${userId}`,
    );
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit || 20)));

    try {
      const coreFeedKey = CacheKeyBuilder.getCoreFeedKey(
        userId,
        safePage,
        safeLimit,
      );
      let coreFeed = await this.redisService.getWithTags<CoreFeed>(coreFeedKey);
      const isCacheHit = !!coreFeed;

      if (!coreFeed) {
        logger.info("Core feed cache miss, generating...");
        const cursorFeed =
          await this.feedCoreService.generatePersonalizedCoreFeed(
            userId,
            safeLimit,
          );
        coreFeed = {
          data: cursorFeed.data,
          limit: safeLimit,
          page: safePage,
          total: 0,
          totalPages: 0,
          hasMore: cursorFeed.hasMore,
          nextCursor: cursorFeed.nextCursor,
          prevCursor: cursorFeed.prevCursor,
        } as CoreFeed;

        const tags = [
          CacheKeyBuilder.getUserFeedTag(userId),
          CacheKeyBuilder.getFeedPageTag(safePage),
          CacheKeyBuilder.getFeedLimitTag(safeLimit),
        ];
        await this.redisService.setWithTags(coreFeedKey, coreFeed, tags, 300);
      } else {
        logger.info("Core feed cache hit");
      }

      const enrichedFeed =
        await this.feedEnrichmentService.enrichFeedWithCurrentData(
          coreFeed!.data,
          {
            refreshUserData: isCacheHit,
          },
        );

      return {
        ...coreFeed,
        data: this.mapToPostDTOArray(enrichedFeed),
        total: coreFeed!.total ?? 0,
        page: coreFeed!.page ?? safePage,
        totalPages: coreFeed!.totalPages ?? 0,
        limit: coreFeed!.limit ?? safeLimit,
      };
    } catch (error) {
      console.error("Failed to generate personalized feed:", error);
      throw Errors.internal(
        `Could not generate personalized feed for user ${userId}: ${(error as Error).message}`,
      );
    }
  }

  public async getTrendingFeed(
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit || 20)));
    const cacheKey = CacheKeyBuilder.getTrendingFeedKey(safePage, safeLimit);

    let cached = await this.redisService.getWithTags<CoreFeed>(cacheKey);
    const isCacheHit = !!cached;
    if (!cached) {
      const skip = (safePage - 1) * safeLimit;
      const core = await this.feedReadDao.getTrendingFeedWithFacet(
        safeLimit,
        skip,
        {
          timeWindowDays: 14,
          minLikes: 1,
        },
      );
      await this.redisService.setWithTags(
        cacheKey,
        core,
        [
          CacheKeyBuilder.getTrendingFeedTag(),
          CacheKeyBuilder.getFeedPageTag(safePage),
          CacheKeyBuilder.getFeedLimitTag(safeLimit),
        ],
        CacheConfig.FEED.TRENDING_FEED,
      );
      cached = core as CoreFeed;
    }

    const enriched = await this.feedEnrichmentService.enrichFeedWithCurrentData(
      cached.data,
      {
        refreshUserData: isCacheHit,
      },
    );

    return {
      ...cached,
      data: this.mapToPostDTOArray(enriched),
      total: cached.total ?? 0,
      page: cached.page ?? safePage,
      totalPages: cached.totalPages ?? 0,
    };
  }

  public async getNewFeed(
    page: number,
    limit: number,
    forceRefresh = false,
    cursor?: string,
  ): Promise<PaginationResult<PostDTO> & { nextCursor?: string }> {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit || 20)));
    const key = cursor
      ? CacheKeyBuilder.getNewFeedCursorKey(cursor, safeLimit)
      : CacheKeyBuilder.getNewFeedKey(safePage, safeLimit);

    let cached: CoreFeed | null = null;
    if (!forceRefresh) {
      cached = await this.redisService.getWithTags<CoreFeed>(key);
    }

    const isCacheHit = !!cached;
    if (!cached) {
      let core: CoreFeed;
      const useCursorFlow = Boolean(cursor) || safePage === 1;

      if (useCursorFlow) {
        const coreCursor = await this.feedReadDao.getNewFeedWithCursor({
          limit: safeLimit,
          cursor,
        });
        core = {
          data: coreCursor.data as FeedPost[],
          limit: safeLimit,
          hasMore: coreCursor.hasMore,
          nextCursor: coreCursor.nextCursor,
          prevCursor: coreCursor.prevCursor,
          total: 0,
          page: safePage,
          totalPages: 0,
        };
      } else {
        const skip = (safePage - 1) * safeLimit;
        const corePage = await this.feedReadDao.getNewFeed(safeLimit, skip);
        core = {
          data: corePage.data as FeedPost[],
          limit: corePage.limit ?? safeLimit,
          total: corePage.total ?? 0,
          page: corePage.page ?? safePage,
          totalPages: corePage.totalPages ?? 0,
        };
      }

      await this.redisService.setWithTags(
        key,
        core,
        [
          CacheKeyBuilder.getNewFeedTag(),
          ...(cursor
            ? []
            : [
                CacheKeyBuilder.getFeedPageTag(safePage),
                CacheKeyBuilder.getFeedLimitTag(safeLimit),
              ]),
        ],
        CacheConfig.FEED.NEW_FEED,
      );
      cached = core;
    }

    const enriched = await this.feedEnrichmentService.enrichFeedWithCurrentData(
      cached.data,
      {
        refreshUserData: isCacheHit,
      },
    );

    return {
      ...cached,
      data: this.mapToPostDTOArray(enriched),
      total: cached.total ?? 0,
      page: cached.page ?? safePage,
      totalPages: cached.totalPages ?? 0,
    };
  }

  private mapToPostDTOArray(entries: FeedPost[]): PostDTO[] {
    return entries.map((entry) =>
      this.dtoService.toPostDTO(this.ensurePlain(entry) as FeedPost),
    );
  }

  private ensurePlain(entry: FeedPost): FeedPost {
    if (
      entry &&
      typeof (entry as FeedPost & { toObject?: () => FeedPost }).toObject ===
        "function"
    ) {
      return (entry as FeedPost & { toObject: () => FeedPost }).toObject();
    }
    return entry;
  }
}
