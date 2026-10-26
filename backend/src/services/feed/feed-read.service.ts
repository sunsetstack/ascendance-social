import { inject, injectable } from "tsyringe";
import type { RedisService } from "../redis.service";
import type { DTOService } from "../dto.service";
import type { FeedEnrichmentService } from "./feed-enrichment.service";
import { logger } from "@/utils/winston";
import { CacheConfig } from "@/config/cacheConfig";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { CoreFeed, FeedPost, PaginationResult, PostDTO } from "@/types";
import { TOKENS } from "@/types/tokens";
import type { IFeedReadDao } from "@/repositories/interfaces";
import { decodeFeedCursor, FEED_CURSOR_ORDER } from "@/utils/feedCursor";

type CachedNewFeed = CoreFeed & { headCursor?: string };

@injectable()
export class FeedReadService {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Services.DTO) private readonly dtoService: DTOService,
    @inject(TOKENS.Services.FeedEnrichment)
    private readonly feedEnrichmentService: FeedEnrichmentService,
  ) {}

  public async getTrendingFeed(
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit || 20)));
    const cacheKey = CacheKeyBuilder.getTrendingFeedKey(safePage, safeLimit);

    let cached = await this.redisService.getWithTags<CoreFeed>(cacheKey);
    if (!cached) {
      const skip = (safePage - 1) * safeLimit;
      const core = await this.feedReadDao.getTrendingFeed(
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
    if (cursor) {
      decodeFeedCursor(cursor, {
        feed: "new",
        orders: [FEED_CURSOR_ORDER.NEW],
        source: "mongo",
      });
    }

    if (forceRefresh) {
      return this.getNewFeedDelta(safePage, safeLimit, cursor);
    }

    const key = cursor
      ? CacheKeyBuilder.getNewFeedCursorKey(cursor, safeLimit)
      : CacheKeyBuilder.getNewFeedKey(safePage, safeLimit);

    let cached = await this.redisService.getWithTags<CachedNewFeed>(key);

    if (!cached) {
      let core: CachedNewFeed;
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
          headCursor: coreCursor.prevCursor,
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
    );

    return {
      ...this.withoutHeadCursor(cached),
      data: this.mapToPostDTOArray(enriched),
      total: cached.total ?? 0,
      page: cached.page ?? safePage,
      totalPages: cached.totalPages ?? 0,
    };
  }

  public async prewarmNewFeed(): Promise<void> {
    logger.info("Pre-warming New feed cache...");
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
  }

  private async getNewFeedDelta(
    page: number,
    limit: number,
    cursor?: string,
  ): Promise<PaginationResult<PostDTO> & { nextCursor?: string }> {
    const firstPageKey = CacheKeyBuilder.getNewFeedKey(1, limit);
    const visiblePage = cursor
      ? null
      : await this.redisService.getWithTags<CachedNewFeed>(firstPageKey);
    const headCursor = cursor ?? visiblePage?.headCursor;
    const result = await this.feedReadDao.getNewFeedWithCursor({
      limit,
      cursor: headCursor,
      direction: headCursor ? "backward" : "forward",
    });
    const enriched = await this.feedEnrichmentService.enrichFeedWithCurrentData(
      result.data as FeedPost[],
    );

    return {
      data: this.mapToPostDTOArray(enriched),
      limit,
      page,
      total: 0,
      totalPages: 0,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      prevCursor: result.prevCursor,
    } as PaginationResult<PostDTO> & {
      hasMore: boolean;
      nextCursor?: string;
      prevCursor?: string;
    };
  }

  private withoutHeadCursor(feed: CachedNewFeed): CoreFeed {
    const publicFeed = { ...feed };
    delete publicFeed.headCursor;
    return publicFeed;
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
