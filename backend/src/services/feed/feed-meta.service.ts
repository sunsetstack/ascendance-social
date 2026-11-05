import { PostPublicId } from "@/types/branded";
import { inject, injectable } from "tsyringe";
import { RedisService } from "../redis.service";
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
    likesRevision: number,
  ): Promise<void> {
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
        likesRevision,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
