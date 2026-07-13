import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { PostLikeCountReconciledEvent } from "@/application/events/post/post.event";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostLikeCountReconciledHandler
  implements IEventHandler<PostLikeCountReconciledEvent>
{
  constructor(
    @inject(TOKENS.Services.FeedMeta)
    private readonly feedMetaService: FeedMetaService,
  ) {}

  async handle(event: PostLikeCountReconciledEvent): Promise<void> {
    await this.feedMetaService.updatePostLikeMeta(
      event.postId,
      event.likesCount,
    );
  }
}
