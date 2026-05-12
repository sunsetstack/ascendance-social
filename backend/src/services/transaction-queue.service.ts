import { injectable, inject } from "tsyringe";
import { UnitOfWork } from "@/database/UnitOfWork";
import { RedisService } from "./redis.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { RedisClientType } from "redis";

/**
 * Priority levels for queued transactions
 */
export type TransactionPriority = "critical" | "high" | "normal" | "low";

interface QueuedJob {
  id: string;
  jobName: string;
  payload: any;
  priority: TransactionPriority;
  createdAt: number;
  attempts: number;
  maxAttempts: number;
}

/**
 * TransactionQueueService backed by Redis Lists
 *
 * Use this for:
 * - non-time-critical operations that can be deferred
 * - smoothing out load spikes
 * - priority-based processing
 */
@injectable()
export class TransactionQueueService {
  private handlers = new Map<string, (payload: any) => Promise<any>>();
  private blockingClient: RedisClientType | null = null;
  private isProcessing = false;
  
  // metrics
  private metrics = {
    totalEnqueued: 0,
    totalProcessed: 0,
    totalFailed: 0,
    totalDropped: 0,
  };

  constructor(
    @inject(TOKENS.Repositories.UnitOfWork) private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService
  ) {}

  /**
   * Register a handler for a specific job name.
   */
  registerHandler(jobName: string, handler: (payload: any) => Promise<any>) {
    this.handlers.set(jobName, handler);
  }

  /**
   * Enqueue a job for deferred processing with Redis
   */
  async enqueue(
    jobName: string,
    payload: any,
    options?: {
      priority?: TransactionPriority;
      maxAttempts?: number;
    }
  ): Promise<void> {
    const priority = options?.priority ?? "normal";
    
    const job: QueuedJob = {
      id: `job_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      jobName,
      payload,
      priority,
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: options?.maxAttempts ?? 3,
    };

    const queueName = `queue:${priority}`;
    await this.redisService.clientInstance.lPush(queueName, JSON.stringify(job));
    this.metrics.totalEnqueued++;

    this.startProcessing();
  }

  /**
   * Execute a job immediately if system is not under load
   * otherwise queue it for deferred processing
   */
  async executeOrQueue(
    jobName: string,
    payload: any,
    options?: {
      priority?: TransactionPriority;
      loadThreshold?: number;
    }
  ): Promise<void> {
    const uowMetrics = this.unitOfWork.getMetrics();
    const loadThreshold = options?.loadThreshold ?? 40;

    // if system is under load, queue the transaction
    if (
      uowMetrics.currentQueueLength > loadThreshold ||
      uowMetrics.availablePermits < 5
    ) {
      logger.info(
        "[TransactionQueue] System under load, queueing transaction",
        {
          queueLength: uowMetrics.currentQueueLength,
          availablePermits: uowMetrics.availablePermits,
        }
      );
      await this.enqueue(jobName, payload, options);
      return;
    }

    // otherwise execute immediately
    const handler = this.handlers.get(jobName);
    if (!handler) {
      throw new Error(`[TransactionQueue] No handler registered for job: ${jobName}`);
    }
    
    await this.unitOfWork.executeInTransaction(() => handler(payload));
  }

  /**
   * Start the queue processing loop
   */
  public async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      this.blockingClient = this.redisService.clientInstance.duplicate() as RedisClientType;
      await this.blockingClient.connect();
      
      // We don't await processLoop because we want it to run in the background
      this.processLoop().catch(err => {
        logger.error("[TransactionQueue] Process loop crashed", { error: err instanceof Error ? err.message : String(err) });
        this.isProcessing = false;
      });
    } catch (error) {
      logger.error("[TransactionQueue] Failed to start blocking client", { error: error instanceof Error ? error.message : String(error) });
      this.isProcessing = false;
    }
  }

  /**
   * Stop the queue processing loop
   */
  public stopProcessing(): void {
    this.isProcessing = false;
    if (this.blockingClient) {
      this.blockingClient.quit().catch(() => {});
      this.blockingClient = null;
    }
  }

  /**
   * Process the next batch of transactions from the queue
   */
  private async processLoop() {
    while (this.isProcessing && this.blockingClient) {
      try {
        const uowMetrics = this.unitOfWork.getMetrics();
        if (uowMetrics.availablePermits < 5) {
          await new Promise(res => setTimeout(res, 100)); // sleep when overloaded
          continue;
        }

        const queues = [
          "queue:critical",
          "queue:high",
          "queue:normal",
          "queue:low"
        ];
        
        // Wait for up to 1 second for a job
        const popResult = await this.blockingClient.brPop(queues, 1);
        
        if (!popResult) {
          continue;
        }

        const { key: queueName, element: jobJson } = popResult;
        const job = JSON.parse(jobJson) as QueuedJob;

        job.attempts++;
        const handler = this.handlers.get(job.jobName);
        
        if (!handler) {
          logger.error(`[TransactionQueue] No handler found for ${job.jobName}`);
          this.metrics.totalFailed++;
          continue;
        }

        try {
          await this.unitOfWork.executeInTransaction(() => handler(job.payload));
          this.metrics.totalProcessed++;
        } catch (error) {
          if (job.attempts < job.maxAttempts) {
            logger.warn(`[TransactionQueue] Retrying job ${job.id}`, { attempt: job.attempts });
            // re-queue (use rPush as we BRPOP from the right)
            await this.redisService.clientInstance.rPush(queueName, JSON.stringify(job));
          } else {
            this.metrics.totalFailed++;
            logger.error(`[TransactionQueue] Job ${job.id} failed after ${job.attempts} attempts`);
          }
        }
      } catch (error) {
        if (!this.isProcessing) break;
        logger.error("[TransactionQueue] Error in processing loop", { error: error instanceof Error ? error.message : String(error) });
        await new Promise(res => setTimeout(res, 1000));
      }
    }
  }

  /**
   * Get queue sizes by priority
   */
  async getQueueSizes(): Promise<Record<TransactionPriority, number>> {
    try {
      const client = this.redisService.clientInstance;
      if (!client?.isOpen) {
        return { critical: 0, high: 0, normal: 0, low: 0 };
      }
      
      const [critical, high, normal, low] = await Promise.all([
        client.lLen("queue:critical"),
        client.lLen("queue:high"),
        client.lLen("queue:normal"),
        client.lLen("queue:low")
      ]);
      return { critical, high, normal, low };
    } catch {
      return { critical: 0, high: 0, normal: 0, low: 0 };
    }
  }

  /**
   * Get queue metrics
   */
  async getMetrics(): Promise<any> {
    const queueSizes = await this.getQueueSizes();
    return {
      ...this.metrics,
      queueSizes
    };
  }

  /**
   * Clear all queues (for testing/shutdown)
   */
  async clearQueues(): Promise<void> {
    const keys = ["queue:critical", "queue:high", "queue:normal", "queue:low"];
    try {
      await this.redisService.clientInstance.del(keys);
    } catch (e) {
      logger.error("[TransactionQueue] error clearing queues", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}
