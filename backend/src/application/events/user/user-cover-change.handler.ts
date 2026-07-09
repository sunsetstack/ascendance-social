import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserCoverChangedEvent } from "./user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class UserCoverChangedHandler implements IEventHandler<UserCoverChangedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
  ) {}

  async handle(event: UserCoverChangedEvent): Promise<void> {
    logger.info(
      `User ${event.userPublicId} changed cover from "${event.oldCoverUrl || "none"}" to "${event.newCoverUrl}"`,
    );

    const coverTags = [`user_data:${event.userPublicId}`];
    await this.redis.invalidateByTags(coverTags);

    logger.info(
      `Cache invalidation completed for cover change of user ${event.userPublicId}`,
    );
  }
}
