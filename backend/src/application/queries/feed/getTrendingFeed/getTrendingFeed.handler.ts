import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetTrendingFeedQuery } from "./getTrendingFeed.query";
import type {
  IPostReadRepository,
  IUserReadRepository,
  IFeedReadDao,
} from "@/repositories/interfaces";
import { RedisService } from "@/services/redis.service";
import { DTOService } from "@/services/dto.service";
import { Errors } from "@/utils/errors";
import { redisLogger } from "@/utils/winston";
import { FeedPost, PaginatedFeedResult, IPost, IImage, ITag } from "@/types";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetTrendingFeedQueryHandler implements IQueryHandler<
  GetTrendingFeedQuery,
  PaginatedFeedResult
> {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.PostRead)
    private postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userReadRepository: IUserReadRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.Services.DTO) private dtoService: DTOService,
    @inject(TOKENS.Services.FeedEnrichment)
    private feedEnrichmentService: FeedEnrichmentService,
  ) {}

  async execute(query: GetTrendingFeedQuery): Promise<PaginatedFeedResult> {
    const { page, limit, cursor } = query;
    redisLogger.info(`getTrendingFeed called`, {
      page,
      limit,
      hasCursor: !!cursor,
    });

    try {
      // Always try cursor-based pagination (Redis or DB)
      // If cursor is undefined, it fetches the first page
      redisLogger.debug("Using cursor-based trending feed strategy");

      let isNewPhase = false;
      let actualCursor = cursor;
      if (cursor?.startsWith("new_phase:")) {
        isNewPhase = true;
        actualCursor = cursor.replace("new_phase:", "");
      }

      if (isNewPhase) {
        const result = await this.feedReadDao.getNewFeedWithCursor({
          limit,
          cursor: actualCursor,
        });
        const transformedPosts = this.transformPosts(result.data);
        const enriched =
          await this.feedEnrichmentService.enrichFeedWithCurrentData(
            transformedPosts,
          );

        return {
          data: enriched,
          page: page,
          limit,
          total: 0,
          totalPages: 0,
          nextCursor: result.nextCursor
            ? `new_phase:${result.nextCursor}`
            : undefined,
          hasMore: result.hasMore,
        };
      }

      // Try Redis ZSET first
      try {
        const redisResult = await this.redisService.getTrendingFeedWithCursor(
          limit,
          cursor,
        );
        if (redisResult.ids.length > 0) {
          redisLogger.info(`Trending feed ZSET HIT`, {
            count: redisResult.ids.length,
          });
          const posts = await this.postReadRepository.findPostsByPublicIds(
            redisResult.ids,
          );

          // Re-sort to match Redis order
          const postMap = new Map(posts.map((p) => [p.publicId, p]));
          const orderedPosts = redisResult.ids
            .map((id) => postMap.get(id))
            .filter((p): p is FeedPost => p !== undefined);

          const transformedPosts = this.transformPosts(orderedPosts);
          const enriched =
            await this.feedEnrichmentService.enrichFeedWithCurrentData(
              transformedPosts,
            );

          return {
            data: enriched,
            page: page, // keep page for backward compat in response structure
            limit,
            total: 0,
            totalPages: 0,
            nextCursor: redisResult.nextCursor,
            hasMore: redisResult.hasMore,
          };
        }
      } catch (err) {
        redisLogger.warn(
          "Failed to get trending feed from Redis, falling back to DB",
          { error: err },
        );
      }

      // Fallback to DB cursor pagination
      redisLogger.info(
        "Falling back to DB cursor pagination for trending feed",
      );
      let result = await this.feedReadDao.getTrendingFeedWithCursor({
        limit,
        cursor: actualCursor,
        timeWindowDays: 30,
        minLikes: 1,
      });

      let transformedPosts = this.transformPosts(result.data);
      let nextCursor = result.nextCursor;
      let hasMore = result.hasMore;

      // When trending content is exhausted, transition to chronological (new) feed
      if (!hasMore) {
        const needed = limit - transformedPosts.length;
        if (needed > 0) {
          // Current page isn't full backfill the remainder with new posts
          const backfill = await this.feedReadDao.getNewFeedWithCursor({
            limit: needed + 1,
          });
          const existingIds = new Set(transformedPosts.map((p) => p.publicId));

          const uniqueBackfill = backfill.data.filter(
            (p) => !existingIds.has(p.publicId),
          );
          const mappedBackfill = this.transformPosts(uniqueBackfill);

          transformedPosts = [...transformedPosts, ...mappedBackfill];
          nextCursor = backfill.nextCursor
            ? `new_phase:${backfill.nextCursor}`
            : undefined;
          hasMore = backfill.hasMore;
        } else {
          // Current page is full with trending posts, but there are no more trending posts.
          // Fetch a single new feed page so we can generate the new_phase cursor for the NEXT request.
          const backfill = await this.feedReadDao.getNewFeedWithCursor({
            limit: limit + 1,
          });
          nextCursor = backfill.nextCursor
            ? `new_phase:${backfill.nextCursor}`
            : undefined;
          hasMore = backfill.data.length > 0;
        }
      }

      // Ensure we respect the limit
      if (transformedPosts.length > limit) {
        transformedPosts = transformedPosts.slice(0, limit);
        hasMore = true;
      }

      const enriched =
        await this.feedEnrichmentService.enrichFeedWithCurrentData(
          transformedPosts,
        );

      return {
        data: enriched,
        page: page,
        limit,
        total: 0,
        totalPages: 0,
        nextCursor,
        hasMore,
      };
    } catch (error) {
      redisLogger.error("Trending feed error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw Errors.internal("Could not generate trending feed.");
    }
  }

  private transformPosts(
    posts: (IPost | FeedPost | Record<string, unknown>)[],
  ): FeedPost[] {
    return posts.map((post) => {
      const plainPost =
        typeof (post as IPost).toObject === "function"
          ? (post as IPost).toObject()
          : (post as Record<string, unknown>);
      const userDoc = this.getUserSnapshot(plainPost);
      const imageDoc = plainPost.image as
        | IImage
        | Record<string, unknown>
        | undefined;
      const repostOfDoc = plainPost.repostOf as
        | IPost
        | Record<string, unknown>
        | undefined;
      const tagsArray = (
        Array.isArray(plainPost.tags) ? plainPost.tags : []
      ) as unknown[];
      const normalizedTags = tagsArray.reduce<
        { tag: string; publicId?: string }[]
      >((acc, tag) => {
        if (tag && typeof tag === "object") {
          if ("tag" in tag) {
            acc.push({
              tag: (tag as { tag: string }).tag,
              publicId: (tag as { publicId?: string }).publicId,
            });
          } else {
            acc.push({ tag: (tag as ITag).tag });
          }
        }
        return acc;
      }, []);

      return {
        publicId: plainPost.publicId as string,
        body: (plainPost.body as string) ?? "",
        slug: (plainPost.slug as string) ?? "",
        createdAt: plainPost.createdAt as Date,
        likes: (plainPost.likesCount as number) ?? 0,
        commentsCount: (plainPost.commentsCount as number) ?? 0,
        viewsCount: (plainPost.viewsCount as number) ?? 0,
        userPublicId: userDoc?.publicId as string,
        tags: normalizedTags,
        user: {
          publicId: userDoc?.publicId as string,
          handle: userDoc?.handle ?? "",
          username: userDoc?.username as string,
          avatar: userDoc?.avatar ?? userDoc?.avatarUrl ?? "",
        },
        image: imageDoc
          ? {
              publicId: (imageDoc as IImage).publicId,
              url: (imageDoc as IImage).url,
              slug: (imageDoc as IImage).slug,
            }
          : undefined,
        repostOf: repostOfDoc ? this.transformRepostOf(repostOfDoc) : undefined,
        rankScore: plainPost.rankScore as number | undefined,
        trendScore: plainPost.trendScore as number | undefined,
      };
    });
  }

  private transformRepostOf(
    repostOf: IPost | Record<string, unknown>,
  ): Partial<FeedPost> | undefined {
    if (!repostOf) return undefined;

    const originalUserDoc = this.getUserSnapshot(repostOf);
    const originalImageDoc = repostOf.image as
      | IImage
      | Record<string, unknown>
      | undefined;
    const originalTagsArray = (
      Array.isArray(repostOf.tags) ? repostOf.tags : []
    ) as unknown[];
    const normalizedOriginalTags = originalTagsArray.reduce<
      { tag: string; publicId?: string }[]
    >((acc, tag: unknown) => {
      if (tag && typeof tag === "object") {
        if ("tag" in tag) {
          acc.push({
            tag: (tag as { tag: string }).tag,
            publicId: (tag as { publicId?: string }).publicId,
          });
        } else {
          acc.push({ tag: (tag as ITag).tag });
        }
      }
      return acc;
    }, []);

    return {
      publicId: repostOf.publicId as string,
      body: (repostOf.body as string) ?? "",
      slug: (repostOf.slug as string) ?? "",
      createdAt: repostOf.createdAt as Date,
      likes: (repostOf.likesCount as number) ?? 0,
      commentsCount: (repostOf.commentsCount as number) ?? 0,
      tags: normalizedOriginalTags,
      user: {
        publicId: originalUserDoc?.publicId as string,
        handle: originalUserDoc?.handle ?? "",
        username: originalUserDoc?.username as string,
        avatar: originalUserDoc?.avatar ?? originalUserDoc?.avatarUrl ?? "",
      },
      image: originalImageDoc
        ? ({
            publicId: originalImageDoc.publicId,
            url: originalImageDoc.url,
            slug: originalImageDoc.slug,
          } as IImage)
        : undefined,
    };
  }

  private getUserSnapshot(post: IPost | Record<string, unknown>): {
    publicId?: string;
    handle?: string;
    username?: string;
    avatar?: string;
    avatarUrl?: string;
  } {
    const rawUser =
      "user" in post ? (post as Record<string, unknown>).user : undefined;
    if (
      rawUser &&
      typeof rawUser === "object" &&
      ("publicId" in rawUser || "username" in rawUser)
    ) {
      return rawUser as {
        publicId?: string;
        handle?: string;
        username?: string;
        avatar?: string;
        avatarUrl?: string;
      };
    }
    const author =
      "author" in post ? (post as Record<string, unknown>).author : undefined;
    return (
      (author as {
        publicId?: string;
        handle?: string;
        username?: string;
        avatar?: string;
        avatarUrl?: string;
      }) ?? {}
    );
  }
}
