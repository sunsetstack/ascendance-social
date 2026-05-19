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
import { TransactionSemaphore } from "./transaction-semaphore";
import {
  backoffWithJitter,
  isRetryableTransactionError,
} from "./transaction-retry";
import {
  TransactionMetrics,
  TransactionMetricsTracker,
} from "./transaction-metrics";

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

@injectable()
export class UnitOfWork {
  // limits concurrent transactions to prevent overwhelming MongoDB
  private readonly transactionSemaphore: TransactionSemaphore;
  private readonly readSemaphore: TransactionSemaphore;
  private metrics: TransactionMetricsTracker = new TransactionMetricsTracker();

  constructor() {
    if (mongoose.connection.readyState !== 1) {
      throw Errors.database("Database connection not established");
    }
    // allow up to 50 concurrent transactions
    const maxConcurrent = parseInt(
      process.env.MAX_CONCURRENT_TRANSACTIONS || "50",
      10,
    );
    const maxConcurrentReads = parseInt(
      process.env.MAX_CONCURRENT_READS || String(maxConcurrent * 4),
      10,
    );
    this.transactionSemaphore = new TransactionSemaphore(maxConcurrent);
    this.readSemaphore = new TransactionSemaphore(maxConcurrentReads);
  }

  /**
   * Execute work within a MongoDB transaction with automatic retry on transient errors
   * Uses exponential backoff with jitter to handle write conflicts
   */
  async executeInTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    const existingSession = sessionALS.getStore();
    if (existingSession?.inTransaction()) {
      return await work(existingSession);
    }

    const cfg = { ...DEFAULT_CONFIG, ...config };

    // acquire semaphore to limit concurrency
    await this.transactionSemaphore.acquire();
    let attempt = 0;

    try {
      while (true) {
        attempt++;
        this.metrics.recordAttempt();
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

          this.metrics.recordSuccess(attempt);
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

          this.metrics.recordFailure();
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
   * uses a separate semaphore so reads are not throttled by write contention
   */
  async executeWithoutTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.readSemaphore.acquire();
    try {
      return await work();
    } finally {
      this.readSemaphore.release();
    }
  }

  private isRetryableError(error: unknown): boolean {
    return isRetryableTransactionError(error);
  }

  private async backoffWithJitter(
    attempt: number,
    baseMs: number,
    maxMs: number,
  ): Promise<void> {
    await backoffWithJitter(attempt, baseMs, maxMs);
  }

  /**
   * Get current transaction metrics for monitoring
   */
  getMetrics(): TransactionMetrics {
    return this.metrics.snapshot(this.transactionSemaphore);
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    if (this.metrics instanceof TransactionMetricsTracker) {
      this.metrics.reset();
      return;
    }

    this.metrics = new TransactionMetricsTracker();
  }
}
