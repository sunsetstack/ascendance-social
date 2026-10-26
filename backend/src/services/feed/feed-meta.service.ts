import { PostPublicId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import { RedisService } from "../redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
import { EventRegistry, buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class FeedMetaService {
  constructor(
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
  ) {}

  public async updatePostLikeMeta(
    postPublicId: PostPublicId,
    newTotalLikes: number,
    sourceEventId: string,
  ): Promise<void> {
    const metaKey = CacheKeyBuilder.getPostMetaKey(postPublicId);
    const tags = [`post_meta:${postPublicId}`, `post_likes:${postPublicId}`];

    await this.redisService.patchWithTags(
      metaKey,
      { likes: newTotalLikes },
      tags,
      300,
    );

    await this.redisService.publish(
      EventRegistry.redisChannels.feedUpdates,
      JSON.stringify({
        eventId: buildRealtimeEventId(
          EventRegistry.realtimeMessageTypes.likeUpdate,
          sourceEventId,
        ),
        type: EventRegistry.realtimeMessageTypes.likeUpdate,
        postId: postPublicId,
        newLikes: newTotalLikes,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  public async updatePostViewMeta(
    postPublicId: PostPublicId,
    newViewsCount: number,
  ): Promise<void> {
    const metaKey = CacheKeyBuilder.getPostMetaKey(postPublicId);
    const tags = [`post_meta:${postPublicId}`, `post_views:${postPublicId}`];

    await this.redisService.patchWithTags(
      metaKey,
      { viewsCount: newViewsCount },
      tags,
      300,
    );
  }

  public async updatePostCommentMeta(
    postPublicId: PostPublicId,
    newCommentsCount: number,
  ): Promise<void> {
    const metaKey = CacheKeyBuilder.getPostMetaKey(postPublicId);
    const tags = [`post_meta:${postPublicId}`, `post_comments:${postPublicId}`];

    await this.redisService.patchWithTags(
      metaKey,
      { commentsCount: newCommentsCount },
      tags,
      300,
    );
  }
}
