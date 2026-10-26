import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { ImageDeletedEvent } from "./image.event";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ImageDeleteHandler implements IEventHandler<ImageDeletedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: ImageDeletedEvent): Promise<void> {
    logger.info(
      `Image deleted: ${event.imageId} by ${event.uploaderPublicId}, invalidating relevant feeds`,
    );

    try {
      // use tag-based invalidation for active cache entries
      const tagsToInvalidate: string[] = [];

      tagsToInvalidate.push(CacheKeyBuilder.getTrendingFeedTag());

      // use tag-based invalidation (efficient - only deletes keys with these tags)
      logger.info(`Invalidating cache with ${tagsToInvalidate.length} tags`);
      await this.redis.invalidateByTags(tagsToInvalidate);

      logger.info(`Feed invalidation complete for image deletion`);
    } catch (error) {
      logger.error("Error handling image deletion", { error });
      const fallbackPatterns = CacheKeyBuilder.getGlobalFeedPatterns();
      await this.redis.deletePatterns(fallbackPatterns);
    }
  }
}
