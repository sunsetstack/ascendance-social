import { inject, injectable } from "tsyringe";
import type {
  IPostReadRepository,
  IUserReadRepository,
} from "@/repositories/interfaces";
import type { IFeedReadDao } from "@/repositories/interfaces/IFeedReadDao";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { FollowRepository } from "@/repositories/follow.repository";
import { EventBus } from "@/application/common/buses/event.bus";
import { ColdStartFeedGeneratedEvent } from "@/application/events/ColdStartFeedGenerated.event";
import { CursorPaginationResult, FeedPost } from "@/types";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

// how long to cache a user's following-IDs list; short TTL keeps feed reasonably fresh
const FOLLOWING_IDS_TTL_SECONDS = 60;

@injectable()
export class FeedCoreService {
  constructor(
    @inject(TOKENS.Repositories.FeedReadDao)
    private readonly feedReadDao: IFeedReadDao,
    @inject(TOKENS.Repositories.PostRead)
    private readonly postReadRepository: IPostReadRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
    @inject(TOKENS.Repositories.UserPreference)
    private readonly userPreferenceRepository: UserPreferenceRepository,
    @inject(TOKENS.Repositories.Follow)
    private readonly followRepository: FollowRepository,
    @inject(TOKENS.CQRS.Handlers.EventBus) private readonly eventBus: EventBus,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  async generatePersonalizedCoreFeed(
    userPublicId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPaginationResult<FeedPost>> {
    const user = await this.userReadRepository.findByPublicId(userPublicId);
    if (!user) {
      throw Errors.notFound("User");
    }

    const [topTags, followingIds] = await Promise.all([
      this.userPreferenceRepository.getTopUserTags(user.id),
      this.getFollowingIdsWithCache(user.id),
    ]);

    const favoriteTags = topTags.map((pref) => pref.tag);

    if (followingIds.length === 0 && favoriteTags.length === 0) {
      if (!cursor) {
        try {
          await this.eventBus.publish(
            new ColdStartFeedGeneratedEvent(userPublicId),
          );
        } catch (error) {
          logger.warn("[FeedCoreService] Failed to publish cold-start event", {
            userPublicId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return this.feedReadDao.getRankedFeedWithCursor(favoriteTags, {
        limit,
        cursor,
      });
    }

    return this.feedReadDao.getFeedForUserCoreWithCursor(
      followingIds,
      favoriteTags,
      { limit, cursor },
    );
  }

  /**
   * Returns the list of user IDs the given user follows, served from a short-lived Redis
   * cache to avoid a DB round-trip on every feed request.
   */
  private async getFollowingIdsWithCache(userId: string): Promise<string[]> {
    const cacheKey = CacheKeyBuilder.getFollowingIdsKey(userId);
    const cached = await this.redisService.get<string[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const ids = await this.followRepository.getFollowingObjectIds(userId);
    await this.redisService.set(cacheKey, ids, FOLLOWING_IDS_TTL_SECONDS);
    return ids;
  }
}
