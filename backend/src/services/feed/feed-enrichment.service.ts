import { inject, injectable } from "tsyringe";
import { RedisService } from "../redis.service";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { FeedPost, UserLookupData } from "@/types";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { CacheConfig } from "@/config/cacheConfig";
import { TOKENS } from "@/types/tokens";

@injectable()
export class FeedEnrichmentService {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
  ) {}

  /**
   * Hydrates a list of FeedPosts with fresh User and Meta data.
   *
   * @pattern Read-Time Hydration
   * @complexity O(N) where N is feed size (uses batched lookups).
   *
   * @param coreFeedData - The core feed structure containing post IDs and user IDs.
   * @param options - Options to control data refreshing.
   * @returns {Promise<FeedPost[]>} A list of enriched feed posts.
   */
  async enrichFeedWithCurrentData(
    coreFeedData: FeedPost[],
    options: { refreshUserData: boolean } = { refreshUserData: true },
  ): Promise<FeedPost[]> {
    if (!coreFeedData || coreFeedData.length === 0) return [];

    const postPublicIds = [
      ...new Set(coreFeedData.map((item) => item.publicId).filter(Boolean)),
    ];
    let userMap = new Map<string, UserLookupData>();

    if (options.refreshUserData) {
      // Extract unique user publicIds from feed items
      const userPublicIds = [
        ...new Set(coreFeedData.map((item) => item.userPublicId)),
      ];

      const userData = await this.getUsersWithCache(userPublicIds);
      userMap = new Map<string, UserLookupData>(
        userData.map((user: UserLookupData) => [user.publicId, user]),
      );
    }

    // attempt to load per-post metadata with tag-based caching
    // Assuming granular key is better: post_meta:{id}
    const postMetaKeys = postPublicIds.map((id) =>
      CacheKeyBuilder.getPostMetaKey(id),
    );

    // single MGET round-trip instead of N individual GET calls
    const metaResults = await this.redisService.mGet<any>(postMetaKeys);

    const metaMap = new Map<string, any>();
    postPublicIds.forEach((id, idx) => {
      if (metaResults[idx]) metaMap.set(id, metaResults[idx]);
    });

    // merge fresh user/image data into core feed
    return coreFeedData.map((item) => {
      const meta = metaMap.get(item.publicId);
      const user = userMap.get(item.userPublicId);
      return {
        ...item,
        likes: meta?.likes ?? item.likes,
        commentsCount: meta?.commentsCount ?? item.commentsCount,
        viewsCount: meta?.viewsCount ?? item.viewsCount,
        user: user
          ? {
              publicId: user.publicId,
              handle: user.handle ?? "",
              username: user.username,
              avatar: user.avatar ?? "",
            }
          : item.user,
      };
    });
  }

  /**
   * Fetches users with granular caching strategy.
   * Prevents duplication of cache keys for overlapping sets of users.
   */
  private async getUsersWithCache(
    userPublicIds: string[],
  ): Promise<UserLookupData[]> {
    if (userPublicIds.length === 0) return [];

    const keys = userPublicIds.map((id) => CacheKeyBuilder.getUserDataKey(id));

    // single MGET round-trip to check all users at once
    const cached = await this.redisService.mGet<UserLookupData>(keys);

    const results: UserLookupData[] = [];
    const missingIds: string[] = [];

    for (let i = 0; i < userPublicIds.length; i++) {
      if (cached[i]) {
        results.push(cached[i]!);
      } else {
        missingIds.push(userPublicIds[i]);
      }
    }

    if (missingIds.length > 0) {
      const fetchedUsers =
        await this.userReadRepository.findUsersByPublicIds(missingIds);

      // Store missing back to cache using a pipeline to batch the operations
      if (fetchedUsers.length > 0) {
        const pipeline = this.redisService.clientInstance.multi();

        fetchedUsers.forEach((user) => {
          const key = CacheKeyBuilder.getUserDataKey(user.publicId);
          const tagKey = `tag:user_data:${user.publicId}`;
          const keyTagKey = `key_tags:${key}`;
          const ttl = CacheConfig.FEED.USER_DATA;
          const stringValue = JSON.stringify(user);

          pipeline.setEx(key, ttl, stringValue);
          pipeline.sAdd(tagKey, key);
          pipeline.expire(tagKey, ttl);
          pipeline.sAdd(keyTagKey, `user_data:${user.publicId}`);
          pipeline.expire(keyTagKey, ttl);
        });

        await pipeline.exec();
        this.redisService.clientInstance.emit(
          "info",
          `Pipeline batch set completed for ${fetchedUsers.length} users.`,
        );
      }

      results.push(...fetchedUsers);
    }

    return results;
  }
}
