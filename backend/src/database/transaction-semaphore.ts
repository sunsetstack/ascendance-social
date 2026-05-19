export class TransactionSemaphore {
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
