import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { inject, injectable } from "tsyringe";
import { ClearCacheCommand } from "./clearCache.command";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";

export interface ClearCacheResult {
  message: string;
  pattern: string;
  deletedKeys: number;
}

@injectable()
export class ClearCacheCommandHandler implements ICommandHandler<
  ClearCacheCommand,
  ClearCacheResult
> {
  constructor(
    @inject(TOKENS.Services.Redis)
    private readonly redisService: RedisService,
  ) {}

  async execute(command: ClearCacheCommand): Promise<ClearCacheResult> {
    const patternToDelete = command.pattern ?? "all_feeds";

    let deletedCount = 0;

    if (patternToDelete === "all_feeds") {
      const patterns = [
        ...CacheKeyBuilder.getGlobalFeedPatterns(true),
        "tag:*",
        "key_tags:*",
      ];

      for (const pattern of patterns) {
        deletedCount += await this.redisService.del(pattern);
      }
    } else {
      deletedCount = await this.redisService.del(patternToDelete);
    }

    return {
      message: "Cache cleared successfully",
      pattern: patternToDelete,
      deletedKeys: deletedCount,
    };
  }
}
