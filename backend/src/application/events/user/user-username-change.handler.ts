import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { inject, injectable } from "tsyringe";
import { UserUsernameChangedEvent } from "./user-interaction.event";
import { RedisService } from "@/services/redis.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import type { IUserReadRepository } from "@/repositories/interfaces";

@injectable()
export class UserUsernameChangedHandler implements IEventHandler<UserUsernameChangedEvent> {
  constructor(
    @inject(TOKENS.Services.Redis) private readonly redis: RedisService,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
  ) {}

  async handle(event: UserUsernameChangedEvent): Promise<void> {
    const user = await this.userReadRepository.findByPublicId(
      event.userPublicId,
    );
    if (!user || user.isBanned) return;

    logger.info(
      `User ${event.userPublicId} changed username from "${event.oldUsername}" to "${event.newUsername}"`,
    );

    const userTags = [`user_data:${event.userPublicId}`];
    await this.redis.invalidateByTags(userTags);

    logger.info(
      `Cache invalidation completed for username change of user ${event.userPublicId}`,
    );
  }
}
