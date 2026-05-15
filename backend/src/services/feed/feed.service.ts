import { UserPublicId, PostPublicId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import { PaginationResult, PostDTO } from "@/types";
import { FeedReadService } from "./feed-read.service";
import { FeedInteractionService } from "./feed-interaction.service";
import { FeedMetaService } from "./feed-meta.service";
import { FeedFanoutService } from "./feed-fanout.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class FeedService {
  constructor(
    @inject(TOKENS.Services.FeedRead)
    private readonly feedReadService: FeedReadService,
    @inject(TOKENS.Services.FeedInteraction)
    private readonly feedInteractionService: FeedInteractionService,
    @inject(TOKENS.Services.FeedMeta)
    private readonly feedMetaService: FeedMetaService,
    @inject(TOKENS.Services.FeedFanout)
    private readonly feedFanoutService: FeedFanoutService,
  ) {}

  public async getPersonalizedFeed(
    userId: string,
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    return this.feedReadService.getPersonalizedFeed(userId, page, limit);
  }

  public async getTrendingFeed(
    page: number,
    limit: number,
  ): Promise<PaginationResult<PostDTO>> {
    return this.feedReadService.getTrendingFeed(page, limit);
  }

  public async getNewFeed(
    page: number,
    limit: number,
    forceRefresh = false,
    cursor?: string,
  ): Promise<PaginationResult<PostDTO> & { nextCursor?: string }> {
    return this.feedReadService.getNewFeed(page, limit, forceRefresh, cursor);
  }

  public async recordInteraction(
    userPublicId: UserPublicId,
    actionType: string,
    targetIdentifier: string,
    tags: string[],
  ): Promise<void> {
    return this.feedInteractionService.recordInteraction(
      userPublicId,
      actionType,
      targetIdentifier,
      tags,
    );
  }

  public async updatePostLikeMeta(
    postPublicId: PostPublicId,
    newTotalLikes: number,
  ): Promise<void> {
    return this.feedMetaService.updatePostLikeMeta(postPublicId, newTotalLikes);
  }

  public async updatePostViewMeta(
    postPublicId: PostPublicId,
    newViewsCount: number,
  ): Promise<void> {
    return this.feedMetaService.updatePostViewMeta(postPublicId, newViewsCount);
  }

  public async updatePostCommentMeta(
    postPublicId: PostPublicId,
    newCommentsCount: number,
  ): Promise<void> {
    return this.feedMetaService.updatePostCommentMeta(
      postPublicId,
      newCommentsCount,
    );
  }

  public async fanOutPostToFollowers(
    postId: string,
    authorId: string,
    timestamp: number,
  ): Promise<void> {
    return this.feedFanoutService.fanOutPostToFollowers(
      postId,
      authorId,
      timestamp,
    );
  }

  public async removePostFromFollowers(
    postId: string,
    authorId: string,
  ): Promise<void> {
    return this.feedFanoutService.removePostFromFollowers(postId, authorId);
  }

  public async prewarmNewFeed(): Promise<void> {
    return this.feedFanoutService.prewarmNewFeed();
  }
}
