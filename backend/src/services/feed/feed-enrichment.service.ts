import { inject, injectable } from "tsyringe";
import { FeedPost, UserLookupData } from "@/types";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId } from "@/types/branded";
import type { UserLookup } from "@/application/ports/user-lookup";
import type { PostCounters } from "@/application/ports/post-counters";
import { traceFeed } from "./feed-trace";

@injectable()
export class FeedEnrichmentService {
  constructor(
    @inject(TOKENS.Services.UserLookup)
    private readonly userLookup: UserLookup,
    @inject(TOKENS.Services.PostCounters)
    private readonly postCounters: PostCounters,
  ) {}

  /** Refreshes authors and, for cached pages, counters with batched reads. */
  async enrichFeedWithCurrentData(
    coreFeedData: FeedPost[],
    options: { refreshUserData?: boolean; refreshCounters?: boolean } = {},
  ): Promise<FeedPost[]> {
    if (!coreFeedData || coreFeedData.length === 0) return [];
    const startedAt = performance.now();
    const refreshUserData = options.refreshUserData ?? true;
    traceFeed("feed.hydration.started", { count: coreFeedData.length, refreshUserData, refreshCounters: options.refreshCounters === true });

    const postPublicIds = options.refreshCounters ? [
      ...new Set(coreFeedData.flatMap((item) => [
        item.publicId, ...(item.repostOf?.publicId ? [item.repostOf.publicId] : []),
      ]).filter(Boolean)),
    ].map(asPostPublicId) : [];

    const userPublicIds = refreshUserData ? [
      ...new Set(
        coreFeedData.flatMap((item) => [
          item.userPublicId,
          ...(item.repostOf?.user?.publicId ? [item.repostOf.user.publicId] : []),
        ]),
      ),
    ] : [];
    const [userData, metaResults] = await Promise.all([
      refreshUserData ? this.userLookup.findMany(userPublicIds) : Promise.resolve([]),
      options.refreshCounters ? this.postCounters.getPostMetadata(postPublicIds) : Promise.resolve([]),
    ]);
    const userMap = new Map<string, UserLookupData>(
      userData.map((user: UserLookupData) => [user.publicId, user]),
    );

    const metaMap = new Map<string, (typeof metaResults)[number]>();
    postPublicIds.forEach((id, idx) => {
      if (metaResults[idx]) metaMap.set(id, metaResults[idx]);
    });

    // Preserve the page's membership and order while refreshing authors and counters.
    return coreFeedData.map((item) => {
      const meta = metaMap.get(item.publicId);
      const repostMeta = item.repostOf ? metaMap.get(item.repostOf.publicId) : undefined;
      const likeMeta = meta && meta.likesRevision >= (item.likesRevision ?? 0) ? meta : undefined;
      const repostLikeMeta = repostMeta && repostMeta.likesRevision >= (item.repostOf?.likesRevision ?? 0) ? repostMeta : undefined;
      const user = userMap.get(item.userPublicId);
      const repostUser = item.repostOf
        ? userMap.get(item.repostOf.user.publicId)
        : undefined;
      traceFeed("feed.hydration.post", { postPublicId: item.publicId,
        metadataSource: meta ? "mongodb" : "loaded_post", authorRefreshed: Boolean(user), originalAuthorRefreshed: Boolean(repostUser),
        before: { likes: item.likes, comments: item.commentsCount, views: item.viewsCount },
        after: { likes: likeMeta?.likes ?? item.likes, comments: meta?.commentsCount ?? item.commentsCount, views: meta?.viewsCount ?? item.viewsCount },
        pinnedRankScore: item.rankScore, reason: item.feedReason, elapsedMs: performance.now() - startedAt,
      });
      return {
        ...item,
        ...(item.repostOf
          ? {
              repostOf: {
                ...item.repostOf,
                likes: repostLikeMeta?.likes ?? item.repostOf.likes,
                likesRevision: repostLikeMeta?.likesRevision ?? item.repostOf.likesRevision,
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
        likes: likeMeta?.likes ?? item.likes,
        likesRevision: likeMeta?.likesRevision ?? item.likesRevision,
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
