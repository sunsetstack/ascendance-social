import { injectable, inject } from "tsyringe";
import { UnitOfWork } from "@/database/UnitOfWork";
import { RedisService } from "./redis.service";
import { logger } from "@/utils/winston";
import { logNonHttpTerminalError } from "@/runtime/non-http-error-logger";
import { TOKENS } from "@/types/tokens";
import { RedisClientType } from "redis";

const RETRYABLE_REDIS_QUEUE_READ_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTDOWN",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
]);
const RETRYABLE_REDIS_QUEUE_READ_ERROR_NAMES = new Set([
  "ConnectionTimeoutError",
  "SocketClosedUnexpectedlyError",
]);

function isRetryableRedisQueueReadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (RETRYABLE_REDIS_QUEUE_READ_ERROR_NAMES.has(error.name)) return true;

  const code = (error as Error & { code?: unknown }).code;
  return (
    typeof code === "string" &&
    RETRYABLE_REDIS_QUEUE_READ_ERROR_CODES.has(code.toUpperCase())
  );
}

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
  private startupPromise: Promise<void> | null = null;
  
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

    await this.startProcessing();
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
    
    await this.unitOfWork.executeWithoutTransaction(() => handler(payload));
  }

  /**
   * Start the queue processing loop
   */
  private async disconnectBlockingClientNoThrow(
    client: RedisClientType,
    operation: "startup" | "process_loop",
  ): Promise<void> {
    try {
      if (client.isOpen) {
        await client.disconnect();
      }
    } catch (cleanupError) {
      if (!client.isOpen) return;

      logger.warn("Failed to disconnect transaction queue blocking Redis client", {
        event: "background.transaction_queue.blocking_client.cleanup_failed",
        worker: "TransactionQueueService",
        operation,
        error: cleanupError,
      });
    }
  }

  public startProcessing(): Promise<void> {
    if (this.startupPromise) return this.startupPromise;
    if (this.isProcessing) return Promise.resolve();

    let startupPromise: Promise<void>;
    startupPromise = this.startProcessingGeneration().finally(() => {
      if (this.startupPromise === startupPromise) {
        this.startupPromise = null;
      }
    });
    this.startupPromise = startupPromise;
    return startupPromise;
  }

  private async startProcessingGeneration(): Promise<void> {
    let blockingClient: RedisClientType | null = null;

    try {
      const startedClient =
        this.redisService.clientInstance.duplicate() as RedisClientType;
      blockingClient = startedClient;
      this.blockingClient = startedClient;
      await startedClient.connect();

      if (this.blockingClient !== startedClient) {
        throw new Error("Transaction queue startup was stopped");
      }

      this.isProcessing = true;
      
      // We don't await processLoop because we want it to run in the background
      void this.processLoop(startedClient)
        .catch((error) => {
          if (this.blockingClient === startedClient) {
            this.blockingClient = null;
            this.isProcessing = false;
          }

          logNonHttpTerminalError(error, {
            message: "Transaction queue process loop crashed",
            event: "background.transaction_queue.process_loop.crashed",
            worker: "TransactionQueueService",
            operation: "process_loop",
          });

          return this.disconnectBlockingClientNoThrow(
            startedClient,
            "process_loop",
          );
        })
        .catch((cleanupError) => {
          logger.warn("Transaction queue process-loop cleanup did not complete", {
            event: "background.transaction_queue.blocking_client.cleanup_failed",
            worker: "TransactionQueueService",
            operation: "process_loop",
            error: cleanupError,
          });
        });
    } catch (error) {
      if (!blockingClient) {
        this.isProcessing = false;
        throw error;
      }

      if (this.blockingClient === blockingClient) {
        this.blockingClient = null;
        this.isProcessing = false;
      }

      await this.disconnectBlockingClientNoThrow(blockingClient, "startup");
      throw error;
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
  private async processLoop(blockingClient: RedisClientType) {
    while (this.isProcessing && this.blockingClient === blockingClient) {
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
        let popResult: { key: string; element: string } | null;
        try {
          popResult = await blockingClient.brPop(queues, 1);
        } catch (error) {
          if (!this.isProcessing || this.blockingClient !== blockingClient) break;
          if (!isRetryableRedisQueueReadError(error)) throw error;

          logger.warn("Transaction queue read failed; retrying", {
            event: "background.transaction_queue.read.retry",
            worker: "TransactionQueueService",
            error,
          });
          await new Promise(res => setTimeout(res, 1000));
          continue;
        }
        
        if (!popResult) {
          continue;
        }

        const { key: queueName, element: jobJson } = popResult;
        const job = JSON.parse(jobJson) as QueuedJob;

        job.attempts++;
        const handler = this.handlers.get(job.jobName);
        
        if (!handler) {
          logNonHttpTerminalError(
            new Error("Transaction queue handler is not registered"),
            {
              message: "Transaction queue job has no registered handler",
              event: "background.transaction_queue.handler.missing",
              worker: "TransactionQueueService",
              operation: "job_handler",
              messageType: job.jobName,
              messageId: job.id,
              attempt: job.attempts,
            },
          );
          this.metrics.totalFailed++;
          continue;
        }

        try {
          await this.unitOfWork.executeWithoutTransaction(() => handler(job.payload));
          this.metrics.totalProcessed++;
        } catch (error) {
          if (job.attempts < job.maxAttempts) {
            logger.warn(`[TransactionQueue] Retrying job ${job.id}`, { attempt: job.attempts });
            // re-queue (use rPush as we BRPOP from the right)
            await this.redisService.clientInstance.rPush(queueName, JSON.stringify(job));
          } else {
            this.metrics.totalFailed++;
            logNonHttpTerminalError(error, {
              message: "Transaction queue job failed",
              event: "background.transaction_queue.job.failed",
              worker: "TransactionQueueService",
              operation: "job_handler",
              messageType: job.jobName,
              messageId: job.id,
              attempt: job.attempts,
            });
          }
        }
      } catch (error) {
        if (!this.isProcessing || this.blockingClient !== blockingClient) break;
        throw error;
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
