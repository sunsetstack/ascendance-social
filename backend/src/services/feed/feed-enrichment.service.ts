import { inject, injectable } from "tsyringe";
import { FeedPost, UserLookupData } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId } from "@/types/branded";
import type { UserLookup } from "@/application/ports/user-lookup";
import type { FeedCache } from "@/application/ports/feed-cache";

@injectable()
export class FeedEnrichmentService {
  constructor(
    @inject(TOKENS.Services.UserLookup)
    private readonly userLookup: UserLookup,
    @inject(TOKENS.Services.FeedCache)
    private readonly feedCache: FeedCache,
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
    ].map(asPostPublicId);
    let userMap = new Map<string, UserLookupData>();

    if (options.refreshUserData) {
      // Extract unique user publicIds from feed items
      const userPublicIds = [
        ...new Set(
          coreFeedData.flatMap((item) => [
            item.userPublicId,
            ...(item.repostOf?.user?.publicId ? [item.repostOf.user.publicId] : []),
          ]),
        ),
      ];

      const userData = await this.userLookup.findMany(userPublicIds);
      userMap = new Map<string, UserLookupData>(
        userData.map((user: UserLookupData) => [user.publicId, user]),
      );
    }

    const metaResults = await this.feedCache.getPostMetadata(postPublicIds);

    const metaMap = new Map<string, (typeof metaResults)[number]>();
    postPublicIds.forEach((id, idx) => {
      if (metaResults[idx]) metaMap.set(id, metaResults[idx]);
    });

    // merge fresh user/image data into core feed
    return coreFeedData.map((item) => {
      const meta = metaMap.get(item.publicId);
      const user = userMap.get(item.userPublicId);
      const repostUser = item.repostOf
        ? userMap.get(item.repostOf.user.publicId)
        : undefined;
      return {
        ...item,
        ...(item.repostOf && repostUser
          ? {
              repostOf: {
                ...item.repostOf,
                user: {
                  publicId: repostUser.publicId,
                  handle: repostUser.handle ?? "",
                  username: repostUser.username,
                  avatar: repostUser.avatar ?? "",
                },
              },
            }
          : {}),
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

}
