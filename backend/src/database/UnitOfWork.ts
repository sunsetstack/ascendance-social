import mongoose, { ClientSession } from "mongoose";
import { injectable } from "tsyringe";
import { logger } from "@/utils/winston";
import {
  Errors,
  getErrorMessage,
  getErrorCode,
  getErrorLabels,
} from "@/utils/errors";
import { AsyncLocalStorage } from "async_hooks";

export const sessionALS = new AsyncLocalStorage<ClientSession>();

/**
 * Configuration for transaction execution
 */
export interface TransactionConfig {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  priority?: "high" | "normal" | "low";
}

const DEFAULT_CONFIG: Required<TransactionConfig> = {
  maxAttempts: 8,
  baseDelayMs: 50,
  maxDelayMs: 5000,
  priority: "normal",
};

/**
 * Semaphore implementation for concurrency limiting
 */
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  get availablePermits(): number {
    return this.permits;
  }

  get queueLength(): number {
    return this.waiting.length;
  }
}

/**
 * Metrics for monitoring transaction health
 */
export interface TransactionMetrics {
  totalAttempts: number;
  successfulTransactions: number;
  failedTransactions: number;
  retriedTransactions: number;
  avgRetryCount: number;
  currentQueueLength: number;
  availablePermits: number;
}

@injectable()
export class UnitOfWork {
  // limits concurrent transactions to prevent overwhelming MongoDB
  private readonly transactionSemaphore: Semaphore;

  // metrics for monitoring
  private metrics = {
    totalAttempts: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
    retriedTransactions: 0,
    totalRetries: 0,
  };

  constructor() {
    if (!mongoose.connection.readyState) {
      throw Errors.database("Database connection not established");
    }
    // allow up to 50 concurrent transactions
    const maxConcurrent = parseInt(
      process.env.MAX_CONCURRENT_TRANSACTIONS || "50",
      10,
    );
    this.transactionSemaphore = new Semaphore(maxConcurrent);
  }

  /**
   * Execute work within a MongoDB transaction with automatic retry on transient errors
   * Uses exponential backoff with jitter to handle write conflicts
   */
  async executeInTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    // acquire semaphore to limit concurrency
    await this.transactionSemaphore.acquire();
    let attempt = 0;

    try {
      while (true) {
        attempt++;
        this.metrics.totalAttempts++;
        const session = await mongoose.startSession();

        try {
          const result = await session.withTransaction(
            async () => {
              return await sessionALS.run(session, async () => {
                return await work(session);
              });
            },
            {
              readPreference: "primary",
              readConcern: { level: "snapshot" },
              writeConcern: { w: "majority" },
              maxCommitTimeMS: 30000,
            },
          );

          this.metrics.successfulTransactions++;
          if (attempt > 1) {
            this.metrics.retriedTransactions++;
            this.metrics.totalRetries += attempt - 1;
          }
          return result as T;
        } catch (error: unknown) {

          const retryable = this.isRetryableError(error);
          const shouldRetry = retryable && attempt < cfg.maxAttempts;

          if (shouldRetry) {
            logger.warn(
              `[UnitOfWork] Transient error on attempt ${attempt}/${cfg.maxAttempts}, retrying...`,
              {
                errorCode: getErrorCode(error),
                errorLabels: getErrorLabels(error),
                message: getErrorMessage(error).substring(0, 100),
              },
            );
            await this.backoffWithJitter(
              attempt,
              cfg.baseDelayMs,
              cfg.maxDelayMs,
            );
            continue;
          }

          this.metrics.failedTransactions++;
          logger.error(
            `[UnitOfWork] Transaction failed after ${attempt} attempts`,
            {
              errorCode: getErrorCode(error),
              errorLabels: getErrorLabels(error),
              message: getErrorMessage(error),
              retryable,
            },
          );
          throw error;
        } finally {
          await session.endSession();
        }
      }
    } finally {
      this.transactionSemaphore.release();
    }
  }

  /**
   * Execute work without a transaction (for read-heavy operations)
   * still respects concurrency limits
   */
  async executeWithoutTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.transactionSemaphore.acquire();
    try {
      return await work();
    } finally {
      this.transactionSemaphore.release();
    }
  }

  /**
   * Check if an error is retryable
   * Covers MongoDB transient transaction errors and write conflicts
   */
  private isRetryableError(error: unknown): boolean {
    if (!error) return false;

    // check error labels first (most reliable)
    const labels = getErrorLabels(error);
    if (labels) {
      if (labels.includes("TransientTransactionError")) return true;
      if (labels.includes("UnknownTransactionCommitResult")) return true;
    }

    // check specific error codes
    const retryableCodes = new Set([
      112, // WriteConflict
      251, // NoSuchTransaction (transaction expired)
      11600, // InterruptedAtShutdown
      11602, // InterruptedDueToReplStateChange
      189, // PrimarySteppedDown
      91, // ShutdownInProgress
      10107, // NotWritablePrimary
      13435, // NotPrimaryNoSecondaryOk
      13436, // NotPrimaryOrSecondary
      64, // WriteConcernFailed (can be transient)
    ]);

    const code = getErrorCode(error);
    if (typeof code === "number" && retryableCodes.has(code)) {
      return true;
    }

    // check error message as fallback
    const message = getErrorMessage(error).toLowerCase();
    const retryableMessages = [
      "write conflict",
      "writeconflict",
      "transient transaction",
      "please retry",
      "transaction was aborted",
      "transaction number",
      "network error",
      "socket exception",
      "connection closed",
      "not primary",
      "node is recovering",
    ];

    return retryableMessages.some((msg) => message.includes(msg));
  }

  /**
   * Exponential backoff with full jitter
   * prevents thundering herd when multiple transactions retry simultaneously
   */
  private async backoffWithJitter(
    attempt: number,
    baseMs: number,
    maxMs: number,
  ): Promise<void> {
    // exponential backoff: baseMs * 2^(attempt-1)
    const exponentialDelay = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs);
    // full jitter: random value between 0 and exponentialDelay
    const jitteredDelay = Math.floor(Math.random() * exponentialDelay);
    // add small minimum delay to prevent immediate retries
    const finalDelay = Math.max(jitteredDelay, 10);

    return new Promise((resolve) => setTimeout(resolve, finalDelay));
  }

  /**
   * Get current transaction metrics for monitoring
   */
  getMetrics(): TransactionMetrics {
    const avgRetryCount =
      this.metrics.retriedTransactions > 0
        ? this.metrics.totalRetries / this.metrics.retriedTransactions
        : 0;

    return {
      totalAttempts: this.metrics.totalAttempts,
      successfulTransactions: this.metrics.successfulTransactions,
      failedTransactions: this.metrics.failedTransactions,
      retriedTransactions: this.metrics.retriedTransactions,
      avgRetryCount: Math.round(avgRetryCount * 100) / 100,
      currentQueueLength: this.transactionSemaphore.queueLength,
      availablePermits: this.transactionSemaphore.availablePermits,
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = {
      totalAttempts: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      retriedTransactions: 0,
      totalRetries: 0,
    };
  }
}
