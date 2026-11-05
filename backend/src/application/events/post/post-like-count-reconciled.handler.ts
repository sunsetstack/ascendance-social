import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { PostLikeCountReconciledEvent } from "@/application/events/post/post.event";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { TOKENS } from "@/types/tokens";
import { buildRealtimeEventId } from "@/application/common/events/event-registry";
import type { IPostReadRepository } from "@/repositories/interfaces/IPostReadRepository";

@injectable()
export class PostLikeCountReconciledHandler implements IEventHandler<PostLikeCountReconciledEvent> {
  constructor(
    @inject(TOKENS.Services.FeedMeta)
    private readonly feedMetaService: FeedMetaService,
    @inject(TOKENS.Repositories.PostRead)
    private readonly posts: IPostReadRepository,
  ) {}

  async handle(event: PostLikeCountReconciledEvent): Promise<void> {
    const post = await this.posts.findOneByPublicId(event.postId);
    if (!post) return;
    const sourceEventId =
      typeof event.eventId === "string" && event.eventId.length > 0
        ? event.eventId
        : buildRealtimeEventId(
            event.type,
            event.postId,
            post.likesRevision ?? 0,
          );

    await this.feedMetaService.updatePostLikeMeta(
      event.postId,
      post.likesCount ?? 0,
      sourceEventId,
      post.likesRevision ?? 0,
    );
  }
}
