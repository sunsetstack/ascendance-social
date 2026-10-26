import { TransactionSemaphore } from "./transaction-semaphore";

export interface TransactionMetrics {
  totalAttempts: number;
  successfulTransactions: number;
  failedTransactions: number;
  retriedTransactions: number;
  avgRetryCount: number;
  currentQueueLength: number;
  availablePermits: number;
}

export interface TransactionObservabilityMetrics extends TransactionMetrics {
  commitAttempts: number;
  bodyRetries: number;
  commitRetries: number;
  ambiguousTransactions: number;
  rejectedTransactions: number;
  durationSeconds: number;
  queueWaitSeconds: number;
}

type MutableTransactionMetrics = {
  totalAttempts: number;
  successfulTransactions: number;
  failedTransactions: number;
  retriedTransactions: number;
  totalRetries: number;
};

const EMPTY_METRICS = (): MutableTransactionMetrics => ({
  totalAttempts: 0,
  successfulTransactions: 0,
  failedTransactions: 0,
  retriedTransactions: 0,
  totalRetries: 0,
});

export class TransactionMetricsTracker {
  private metrics: MutableTransactionMetrics = EMPTY_METRICS();
  private commitAttempts = 0;
  private bodyRetries = 0;
  private commitRetries = 0;
  private ambiguousTransactions = 0;
  private rejectedTransactions = 0;
  private durationSeconds = 0;
  private queueWaitSeconds = 0;

  recordCommitAttempt(): void { this.commitAttempts++; }
  recordRetry(phase: "body" | "commit"): void {
    if (phase === "body") this.bodyRetries++;
    else this.commitRetries++;
  }
  recordAmbiguous(): void { this.ambiguousTransactions++; }
  recordRejected(): void { this.rejectedTransactions++; }
  recordDuration(durationMs: number, queueWaitMs: number): void {
    this.durationSeconds += Math.max(0, durationMs) / 1000;
    this.queueWaitSeconds += Math.max(0, queueWaitMs) / 1000;
  }

  observabilitySnapshot(semaphore: TransactionSemaphore): TransactionObservabilityMetrics {
    return { ...this.snapshot(semaphore), commitAttempts: this.commitAttempts,
      bodyRetries: this.bodyRetries, commitRetries: this.commitRetries,
      ambiguousTransactions: this.ambiguousTransactions, rejectedTransactions: this.rejectedTransactions,
      durationSeconds: this.durationSeconds, queueWaitSeconds: this.queueWaitSeconds };
  }

  recordAttempt(): void {
    this.metrics.totalAttempts++;
  }

  recordSuccess(attempt: number): void {
    this.metrics.successfulTransactions++;
    if (attempt > 1) {
      this.metrics.retriedTransactions++;
      this.metrics.totalRetries += attempt - 1;
    }
  }

  recordFailure(): void {
    this.metrics.failedTransactions++;
  }

  snapshot(transactionSemaphore: TransactionSemaphore): TransactionMetrics {
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
      currentQueueLength: transactionSemaphore.queueLength,
      availablePermits: transactionSemaphore.availablePermits,
    };
  }

  reset(): void {
    this.metrics = EMPTY_METRICS();
    this.commitAttempts = this.bodyRetries = this.commitRetries = 0;
    this.ambiguousTransactions = this.rejectedTransactions = 0;
    this.durationSeconds = this.queueWaitSeconds = 0;
  }
}
