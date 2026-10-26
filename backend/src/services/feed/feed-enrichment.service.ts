import { inject, injectable } from "tsyringe";
import { FeedPost, UserLookupData } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId } from "@/types/branded";
import type { UserLookup } from "@/application/ports/user-lookup";
import type { FeedCache } from "@/application/ports/feed-cache";
import { traceFeed } from "./feed-trace";

@injectable()
export class FeedEnrichmentService {
  constructor(
    @inject(TOKENS.Services.UserLookup)
    private readonly userLookup: UserLookup,
    @inject(TOKENS.Services.FeedCache)
    private readonly feedCache: FeedCache,
  ) {}

  /** Refreshes author snapshots and counters with batched reads. */
  async enrichFeedWithCurrentData(
    coreFeedData: FeedPost[],
    options: { refreshUserData: boolean } = { refreshUserData: true },
  ): Promise<FeedPost[]> {
    if (!coreFeedData || coreFeedData.length === 0) return [];
    const startedAt = performance.now();
    traceFeed("feed.hydration.started", { count: coreFeedData.length, refreshUserData: options.refreshUserData });

    const postPublicIds = [
      ...new Set(coreFeedData.flatMap((item) => [
        item.publicId, ...(item.repostOf?.publicId ? [item.repostOf.publicId] : []),
      ]).filter(Boolean)),
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
      const repostMeta = item.repostOf ? metaMap.get(item.repostOf.publicId) : undefined;
      const user = userMap.get(item.userPublicId);
      const repostUser = item.repostOf
        ? userMap.get(item.repostOf.user.publicId)
        : undefined;
      traceFeed("feed.hydration.post", { postPublicId: item.publicId,
        metadataSource: meta ? "redis" : "loaded_post", authorRefreshed: Boolean(user), originalAuthorRefreshed: Boolean(repostUser),
        before: { likes: item.likes, comments: item.commentsCount, views: item.viewsCount },
        after: { likes: meta?.likes ?? item.likes, comments: meta?.commentsCount ?? item.commentsCount, views: meta?.viewsCount ?? item.viewsCount },
        pinnedRankScore: item.rankScore, reason: item.feedReason, elapsedMs: performance.now() - startedAt,
      });
      return {
        ...item,
        ...(item.repostOf
          ? {
              repostOf: {
                ...item.repostOf,
                likes: repostMeta?.likes ?? item.repostOf.likes,
                commentsCount: repostMeta?.commentsCount ?? item.repostOf.commentsCount,
                user: repostUser ? {
                  publicId: repostUser.publicId,
                  handle: repostUser.handle ?? "",
                  username: repostUser.username,
                  avatar: repostUser.avatar ?? "",
                } : item.repostOf.user,
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
