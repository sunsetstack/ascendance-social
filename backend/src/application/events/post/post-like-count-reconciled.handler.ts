import { inject, injectable } from "tsyringe";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { PostLikeCountReconciledEvent } from "@/application/events/post/post.event";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { TOKENS } from "@/types/tokens";
import { buildRealtimeEventId } from "@/application/common/events/event-registry";

@injectable()
export class PostLikeCountReconciledHandler
  implements IEventHandler<PostLikeCountReconciledEvent>
{
  constructor(
    @inject(TOKENS.Services.FeedMeta)
    private readonly feedMetaService: FeedMetaService,
  ) {}

  async handle(event: PostLikeCountReconciledEvent): Promise<void> {
    const persistedTimestamp: unknown = event.timestamp;
    const sourceEventId =
      typeof event.eventId === "string" && event.eventId.length > 0
        ? event.eventId
        : buildRealtimeEventId(
            event.type,
            event.postId,
            event.likesCount,
            persistedTimestamp instanceof Date
              ? persistedTimestamp.toISOString()
              : String(persistedTimestamp),
          );

    await this.feedMetaService.updatePostLikeMeta(
      event.postId,
      event.likesCount,
      sourceEventId,
    );
  }
}
