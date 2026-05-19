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
  }
}
