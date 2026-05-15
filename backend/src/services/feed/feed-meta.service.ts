import { PostPublicId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import { RedisService } from "../redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

@injectable()
export class FeedMetaService {
  constructor(
    @inject(TOKENS.Services.Redis) private redisService: RedisService,
  ) {}

  public async updatePostLikeMeta(
    postPublicId: PostPublicId,
    newTotalLikes: number,
  ): Promise<void> {
    const metaKey = CacheKeyBuilder.getPostMetaKey(postPublicId);
    const tags = [`post_meta:${postPublicId}`, `post_likes:${postPublicId}`];
    const existingMeta = (await this.redisService.getWithTags(metaKey)) || {};

    await this.redisService.setWithTags(
      metaKey,
      {
        ...existingMeta,
        likes: newTotalLikes,
      },
      tags,
      300,
    );

    await this.redisService.publish(
      "feed_updates",
      JSON.stringify({
        type: "like_update",
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
    const existingMeta = (await this.redisService.getWithTags(metaKey)) || {};

    await this.redisService.setWithTags(
      metaKey,
      {
        ...existingMeta,
        viewsCount: newViewsCount,
      },
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
    const existingMeta = (await this.redisService.getWithTags(metaKey)) || {};

    await this.redisService.setWithTags(
      metaKey,
      {
        ...existingMeta,
        commentsCount: newCommentsCount,
      },
      tags,
      300,
    );
  }
}
