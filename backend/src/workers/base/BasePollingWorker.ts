import { logger } from "@/utils/winston";
import type { IWorker } from "./IWorker";

/**
 * @pattern Template Method
 *
 * Abstract base for workers that poll on a fixed interval.
 *
 * Lifecycle:
 *  - `start()` fires `tick()` immediately, then re-schedules via setTimeout
 *    in the `finally` block so the interval is measured between completions.
 *  - `stop()` awaits any in-flight tick before returning, preventing
 *    data corruption during graceful shutdown.
 *
 * Subclasses implement `tick()` (the actual work) and optionally `init()`.
 */
export abstract class BasePollingWorker implements IWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private currentTick: Promise<void> | null = null;

  constructor(
    protected readonly workerName: string,
    protected readonly intervalMs: number,
  ) {}

  async init(): Promise<void> {
    // Override in subclass if DI resolution or setup is needed
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info(`[${this.workerName}] Starting (interval=${this.intervalMs}ms)`);
    this.schedule();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Wait for in-flight tick to finish before returning
    if (this.currentTick) {
      await this.currentTick;
      this.currentTick = null;
    }
    logger.info(`[${this.workerName}] Stopped`);
  }

  /** The actual work performed each cycle. Implement in subclass. */
  protected abstract tick(): Promise<void>;

  private schedule(): void {
    if (!this.isRunning) return;
    this.currentTick = this.executeTick();
  }

  private async executeTick(): Promise<void> {
    try {
      await this.tick();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[${this.workerName}] Tick error: ${message}`);
    } finally {
      if (this.isRunning) {
        this.timer = setTimeout(() => this.schedule(), this.intervalMs);
      }
    }
  }
}
