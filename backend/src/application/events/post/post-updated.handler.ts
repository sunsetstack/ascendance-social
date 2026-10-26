import { inject, injectable } from "tsyringe";
import type { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { PostUpdatedEvent } from "./post.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostUpdateHandler implements IEventHandler<PostUpdatedEvent> {
  constructor(@inject(TOKENS.Services.Redis) private readonly redis: RedisService) {}

  async handle(_event: PostUpdatedEvent): Promise<void> {
    await this.redis.invalidateByTags([
      CacheKeyBuilder.getTrendingFeedTag(),
      CacheKeyBuilder.getNewFeedTag(),
    ]);
  }
}
