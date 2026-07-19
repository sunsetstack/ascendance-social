export const DEFAULT_TRANSACTION_SEMAPHORE_WAIT_TIMEOUT_MS = 30_000;

export class TransactionSemaphoreTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Timed out waiting ${timeoutMs}ms for a transaction permit`);
    this.name = "TransactionSemaphoreTimeoutError";
  }
}

interface SemaphoreWaiter {
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: Error): void;
}

export class TransactionSemaphore {
  private permits: number;
  private waiting: SemaphoreWaiter[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(timeoutMs?: number): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        settled: false,
        resolve,
        reject,
      };
      this.waiting.push(waiter);

      if (timeoutMs !== undefined) {
        waiter.timer = setTimeout(() => {
          if (waiter.settled) return;

          const index = this.waiting.indexOf(waiter);
          if (index === -1) return;

          this.waiting.splice(index, 1);
          waiter.settled = true;
          waiter.reject(new TransactionSemaphoreTimeoutError(timeoutMs));
        }, timeoutMs);
      }
    });
  }

  release(): void {
    while (this.waiting.length > 0) {
      const next = this.waiting.shift()!;
      if (next.settled) continue;

      next.settled = true;
      if (next.timer !== undefined) clearTimeout(next.timer);
      next.resolve();
      return;
    }

    this.permits++;
  }

  get availablePermits(): number {
    return this.permits;
  }

  get queueLength(): number {
    return this.waiting.length;
  }
}
