import { inject, injectable } from "tsyringe";
import { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { GetForYouFeedQuery } from "./getForYouFeed.query";
import type {
  IPostReadRepository,
  IUserReadRepository,
  IFeedReadDao,
} from "@/repositories/interfaces";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { RedisService } from "@/services/redis.service";
import { EventBus } from "@/application/common/buses/event.bus";
import { Errors } from "@/utils/errors";
import { errorLogger, redisLogger } from "@/utils/winston";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import {
  FeedPost,
  PaginatedFeedResult,
  UserLookupData,
  IPost,
  IImage,
  ITag,
} from "@/types";
import { TOKENS } from "@/types/tokens";

@injectable()
export class GetForYouFeedQueryHandler implements IQueryHandler<
  GetForYouFeedQuery,
  PaginatedFeedResult
> {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.PostRead)
    private postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
    @inject(TOKENS.CQRS.Handlers.EventBus) private eventBus: EventBus,
    @inject(TOKENS.Services.FeedEnrichment)
    private feedEnrichmentService: FeedEnrichmentService,
  ) {}

  async execute(query: GetForYouFeedQuery): Promise<PaginatedFeedResult> {
    const { userId, page, limit, cursor } = query;
    redisLogger.info(`getForYouFeed called`, {
      userId,
      page,
      limit,
      hasCursor: !!cursor,
    });

    try {
      // 1. Try Redis ZSET with cursor
      try {
        const redisResult = await this.redisService.getFeedWithCursor(
          userId,
          limit,
          cursor,
          "for_you",
        );

        if (redisResult.ids.length > 0) {
          redisLogger.info(`For You feed ZSET HIT`, {
            count: redisResult.ids.length,
          });
          const posts = await this.postReadRepository.findPostsByPublicIds(
            redisResult.ids,
          );

          // Re-sort to match Redis order (crucial for feed consistency)
          const postMap = new Map(posts.map((p) => [p.publicId, p]));
          const orderedPosts = redisResult.ids
            .map((id) => postMap.get(id))
            .filter((p): p is FeedPost => p !== undefined);

          const transformedPosts = this.transformPosts(orderedPosts);
          const enriched =
            await this.feedEnrichmentService.enrichFeedWithCurrentData(
              transformedPosts,
            );

          // If we are on the first page/cursor and have data, we assume the feed is populated.
          // If we are deep paginating, we just return what we have.

          return {
            data: enriched,
            page,
            limit,
            total: 0,
            totalPages: 0,
            nextCursor: redisResult.nextCursor,
            hasMore: redisResult.hasMore,
          };
        }
      } catch (err) {
        redisLogger.warn("Failed to get feed from Redis cursor", {
          error: err,
        });
      }

      // 2. Cache Miss - Generate from DB using Cursor Pagination
      redisLogger.info(`For You feed ZSET MISS, generating from DB`, {
        userId,
      });

      const user = await this.userReadRepository.findByPublicId(userId);
      if (!user) {
        throw Errors.notFound("User");
      }
      const topTags = await this.userPreferenceRepository.getTopUserTags(
        String(user._id),
      );
      const favoriteTags = topTags.map((pref) => pref.tag);

      // Use getRankedFeedWithCursor (O(1)) instead of getRankedFeed (O(N))
      const result = await this.feedReadDao.getRankedFeedWithCursor(
        favoriteTags,
        { limit, cursor },
      );
      const transformedFeedData = this.transformPosts(result.data);

      // 3. Populate Redis ZSET (Fire-and-forget)
      // Only populate if we are on the first page (no cursor) to avoid fragmented cache
      if (!cursor && transformedFeedData.length > 0) {
        const timestamp = Date.now();
        redisLogger.info(`Populating ZSET for user`, {
          userId,
          postCount: transformedFeedData.length,
        });

        Promise.all(
          transformedFeedData.map((post: FeedPost, idx: number) => {
            // score = now - idx (so first item has highest score)
            return this.redisService.addToFeed(
              userId,
              post.publicId,
              timestamp - idx,
              "for_you",
            );
          }),
        ).catch((err) => {
          errorLogger.error(`Failed to populate For You feed ZSET`, {
            userId,
            error: err.message,
          });
        });
      }

      const enriched =
        await this.feedEnrichmentService.enrichFeedWithCurrentData(
          transformedFeedData,
        );

      return {
        data: enriched,
        page,
        limit,
        total: 0,
        totalPages: 0,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      };
    } catch (error) {
      errorLogger.error("For You feed error", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw Errors.internal("Could not generate For You feed.");
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
        body: plainPost.body ?? "",
        slug: plainPost.slug ?? "",
        createdAt: plainPost.createdAt as Date,
        likes: plainPost.likesCount ?? plainPost.likes ?? 0,
        commentsCount: plainPost.commentsCount ?? 0,
        viewsCount: plainPost.viewsCount ?? 0,
        userPublicId: userDoc?.publicId as string,
        tags: normalizedTags,
        user: {
          publicId: userDoc?.publicId as string,
          handle: userDoc?.handle ?? "",
          username: userDoc?.username as string,
          avatar: userDoc?.avatar ?? "",
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
    const originalImageDoc = (repostOf as IPost).image as
      | IImage
      | Record<string, unknown>
      | undefined;
    const originalTagsArray = (
      Array.isArray((repostOf as IPost).tags) ? (repostOf as IPost).tags : []
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
      publicId: (repostOf as Record<string, unknown>).publicId as string,
      body: ((repostOf as Record<string, unknown>).body as string) ?? "",
      slug: ((repostOf as Record<string, unknown>).slug as string) ?? "",
      createdAt: (repostOf as Record<string, unknown>).createdAt as Date,
      likes: ((repostOf as Record<string, unknown>).likesCount as number) ?? 0,
      commentsCount:
        ((repostOf as Record<string, unknown>).commentsCount as number) ?? 0,
      tags: normalizedOriginalTags,
      user: {
        publicId: originalUserDoc?.publicId as string,
        handle: originalUserDoc?.handle ?? "",
        username: originalUserDoc?.username as string,
        avatar: originalUserDoc?.avatar ?? "",
      },
      image: originalImageDoc
        ? ({
            publicId: (originalImageDoc as IImage).publicId,
            url: (originalImageDoc as IImage).url,
            slug: (originalImageDoc as IImage).slug,
          } as IImage)
        : undefined,
    };
  }

  private getUserSnapshot(
    post: IPost | Record<string, unknown>,
  ): Partial<UserLookupData> {
    const rawUser =
      "user" in post ? (post as Record<string, unknown>).user : undefined;
    if (
      rawUser &&
      typeof rawUser === "object" &&
      ("publicId" in rawUser || "username" in rawUser)
    ) {
      return rawUser as Partial<UserLookupData>;
    }
    const author =
      "author" in post ? (post as Record<string, unknown>).author : undefined;
    if (author && typeof author === "object") {
      return author as Partial<UserLookupData>;
    }
    return {};
  }

  private async generateForYouFeed(
    userId: string,
    page: number,
    limit: number,
  ) {
    const user = await this.userReadRepository.findByPublicId(userId);
    if (!user) {
      throw Errors.notFound("User");
    }
    const topTags = await this.userPreferenceRepository.getTopUserTags(
      String(user._id),
    );
    const favoriteTags = topTags.map((pref) => pref.tag);
    const skip = (page - 1) * limit;
    return this.feedReadDao.getRankedFeed(favoriteTags, limit, skip);
  }
}
