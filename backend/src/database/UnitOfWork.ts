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
import {
  DEFAULT_TRANSACTION_SEMAPHORE_WAIT_TIMEOUT_MS,
  TransactionSemaphore,
} from "./transaction-semaphore";
import { AmbiguousTransactionCommitError } from "./transaction-errors";
import {
  backoffWithJitter,
  isMaxTimeMSExpiredError,
  isRetryableTransactionBodyError,
  isTransientTransactionError,
  isUnknownTransactionCommitResult,
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
  /** Compatibility alias used for each retry domain when its specific limit is omitted. */
  maxAttempts?: number;
  maxBodyAttempts?: number;
  maxCommitAttempts?: number;
  /** Defaults to 30 seconds. A timed-out waiter never acquires a permit. */
  semaphoreWaitTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Reserved for compatibility. The semaphore is FIFO and does not schedule priorities. */
  priority?: "high" | "normal" | "low";
}

interface ResolvedTransactionConfig {
  maxBodyAttempts: number;
  maxCommitAttempts: number;
  semaphoreWaitTimeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_CONFIG: ResolvedTransactionConfig = {
  maxBodyAttempts: 8,
  maxCommitAttempts: 8,
  semaphoreWaitTimeoutMs: DEFAULT_TRANSACTION_SEMAPHORE_WAIT_TIMEOUT_MS,
  baseDelayMs: 50,
  maxDelayMs: 5000,
};

const TRANSACTION_OPTIONS: mongoose.mongo.TransactionOptions = {
  readPreference: "primary",
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
  maxCommitTimeMS: 30000,
};

function resolveAttemptLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function resolveTransactionConfig(
  config?: TransactionConfig,
): ResolvedTransactionConfig {
  const legacyLimit = config?.maxAttempts;
  const semaphoreWaitTimeoutMs = config?.semaphoreWaitTimeoutMs;

  return {
    maxBodyAttempts: resolveAttemptLimit(
      config?.maxBodyAttempts ?? legacyLimit,
      DEFAULT_CONFIG.maxBodyAttempts,
    ),
    maxCommitAttempts: resolveAttemptLimit(
      config?.maxCommitAttempts ?? legacyLimit,
      DEFAULT_CONFIG.maxCommitAttempts,
    ),
    semaphoreWaitTimeoutMs:
      semaphoreWaitTimeoutMs === undefined ||
      !Number.isFinite(semaphoreWaitTimeoutMs)
        ? DEFAULT_CONFIG.semaphoreWaitTimeoutMs
        : Math.max(0, semaphoreWaitTimeoutMs),
    baseDelayMs: config?.baseDelayMs ?? DEFAULT_CONFIG.baseDelayMs,
    maxDelayMs: config?.maxDelayMs ?? DEFAULT_CONFIG.maxDelayMs,
  };
}

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
    const maxConcurrent = readPositiveIntegerEnv(
      "MAX_CONCURRENT_TRANSACTIONS",
      50,
    );
    const maxConcurrentReads = readPositiveIntegerEnv(
      "MAX_CONCURRENT_READS",
      maxConcurrent * 4,
    );
    this.transactionSemaphore = new TransactionSemaphore(maxConcurrent);
    this.readSemaphore = new TransactionSemaphore(maxConcurrentReads);
  }

  /**
   * Execute work within a MongoDB transaction with separately bounded body and
   * commit retries. An unknown commit result retries commit only.
   */
  async executeInTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> {
    const existingSession = sessionALS.getStore();
    if (existingSession?.inTransaction()) {
      return await work(existingSession);
    }

    const cfg = resolveTransactionConfig(config);

    await this.transactionSemaphore.acquire(cfg.semaphoreWaitTimeoutMs);
    let session: ClientSession | undefined;

    try {
      session = await mongoose.startSession();
      const activeSession = session;

      for (
        let bodyAttempt = 1;
        bodyAttempt <= cfg.maxBodyAttempts;
        bodyAttempt++
      ) {
        this.metrics.recordAttempt();
        let result: T;

        try {
          activeSession.startTransaction(TRANSACTION_OPTIONS);
          result = await sessionALS.run(activeSession, async () => {
            return await work(activeSession);
          });
        } catch (error: unknown) {
          const abortSucceeded = await this.abortIfActive(activeSession, error);
          const retryable = this.isRetryableError(error);
          const shouldRetry =
            abortSucceeded &&
            retryable &&
            bodyAttempt < cfg.maxBodyAttempts;

          if (shouldRetry) {
            logger.warn(
              `[UnitOfWork] Retrying transaction body after attempt ${bodyAttempt}/${cfg.maxBodyAttempts}`,
              {
                errorCode: getErrorCode(error),
                errorLabels: getErrorLabels(error),
                message: getErrorMessage(error).substring(0, 100),
              },
            );
            await this.backoffWithJitter(
              bodyAttempt,
              cfg.baseDelayMs,
              cfg.maxDelayMs,
            );
            continue;
          }

          this.recordDefiniteFailure(error, bodyAttempt, retryable);
          throw error;
        }

        if (!activeSession.inTransaction()) {
          this.metrics.recordSuccess(bodyAttempt);
          return result;
        }

        let retryBody = false;
        for (
          let commitAttempt = 1;
          commitAttempt <= cfg.maxCommitAttempts;
          commitAttempt++
        ) {
          try {
            await activeSession.commitTransaction();
            this.metrics.recordSuccess(bodyAttempt);
            return result;
          } catch (error: unknown) {
            if (isUnknownTransactionCommitResult(error)) {
              const shouldRetryCommit =
                !isMaxTimeMSExpiredError(error) &&
                commitAttempt < cfg.maxCommitAttempts;

              if (shouldRetryCommit) {
                logger.warn(
                  `[UnitOfWork] Commit result unknown on attempt ${commitAttempt}/${cfg.maxCommitAttempts}; retrying commit only`,
                  {
                    errorCode: getErrorCode(error),
                    errorLabels: getErrorLabels(error),
                    message: getErrorMessage(error).substring(0, 100),
                  },
                );
                await this.backoffWithJitter(
                  commitAttempt,
                  cfg.baseDelayMs,
                  cfg.maxDelayMs,
                );
                continue;
              }

              const ambiguousError = new AmbiguousTransactionCommitError(
                commitAttempt,
                error,
              );
              logger.error(
                `[UnitOfWork] Transaction commit outcome unresolved after ${commitAttempt} attempts`,
                {
                  errorCode: getErrorCode(error),
                  errorLabels: getErrorLabels(error),
                  message: getErrorMessage(error),
                },
              );
              throw ambiguousError;
            }

            const retryable = this.isRetryableError(error);
            const abortSucceeded = await this.abortIfActive(
              activeSession,
              error,
            );
            const shouldRetryBody =
              abortSucceeded &&
              isTransientTransactionError(error) &&
              bodyAttempt < cfg.maxBodyAttempts;

            if (shouldRetryBody) {
              logger.warn(
                `[UnitOfWork] Commit proved the transaction transiently failed; retrying body after attempt ${bodyAttempt}/${cfg.maxBodyAttempts}`,
                {
                  errorCode: getErrorCode(error),
                  errorLabels: getErrorLabels(error),
                  message: getErrorMessage(error).substring(0, 100),
                },
              );
              await this.backoffWithJitter(
                bodyAttempt,
                cfg.baseDelayMs,
                cfg.maxDelayMs,
              );
              retryBody = true;
              break;
            }

            this.recordDefiniteFailure(error, bodyAttempt, retryable);
            throw error;
          }
        }

        if (retryBody) continue;
      }

      throw new Error("Transaction body retry loop exited unexpectedly");
    } finally {
      try {
        if (session) await session.endSession();
      } finally {
        this.transactionSemaphore.release();
      }
    }
  }

  private async abortIfActive(
    session: ClientSession,
    primaryError: unknown,
  ): Promise<boolean> {
    if (!session.inTransaction()) return true;

    try {
      await session.abortTransaction();
      return true;
    } catch (abortError: unknown) {
      logger.error(
        "[UnitOfWork] Abort failed; preserving the original transaction error",
        {
          primaryError: getErrorMessage(primaryError),
          abortError: getErrorMessage(abortError),
        },
      );
      return false;
    }
  }

  private recordDefiniteFailure(
    error: unknown,
    bodyAttempt: number,
    retryable: boolean,
  ): void {
    this.metrics.recordFailure();
    logger.error(
      `[UnitOfWork] Transaction failed after ${bodyAttempt} body attempts`,
      {
        errorCode: getErrorCode(error),
        errorLabels: getErrorLabels(error),
        message: getErrorMessage(error),
        retryable,
      },
    );
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
    return isRetryableTransactionBodyError(error);
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
