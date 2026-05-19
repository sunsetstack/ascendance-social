import { inject, injectable } from "tsyringe";
import * as cron from "node-cron";
import { FeedService } from "@/services/feed/feed.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

@injectable()
export class NewFeedWarmCacheWorker {
  private cronJob?: cron.ScheduledTask;

  constructor(
    @inject(TOKENS.Services.Feed)
    private readonly feedService: FeedService,
  ) {}

  async init(): Promise<void> {
    logger.info("New feed warm cache worker initialized");
    // run immediately on startup
    await this.run();
  }

  start(): void {
    // run every hour to keep cache warm
    this.cronJob = cron.schedule("0 * * * *", () => {
      this.run().catch((err) => {
        logger.error("New feed warm cache worker error", { error: err });
      });
    });

    logger.info(
      "New feed warm cache worker started (runs every hour via cron)",
    );
  }

  async stop(): Promise<void> {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = undefined;
      logger.info("New feed warm cache worker stopped");
    }
  }

  private async run(): Promise<void> {
    logger.info("Running new feed warm cache worker...");
    try {
      await this.feedService.prewarmNewFeed();
      logger.info("New feed warm cache worker completed successfully");
    } catch (error) {
      logger.error("New feed warm cache worker failed", { error });
    }
  }
}
