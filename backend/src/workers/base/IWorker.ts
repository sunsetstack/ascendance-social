/**
 * @pattern Template Method (Interface)
 *
 * Shared lifecycle contract for all background workers.
 * Workers that poll on an interval should extend BasePollingWorker.
 * Workers with unique execution models (Redis streams, pub/sub, cron)
 * implement this interface directly.
 */
export interface IWorker {
  /** One-time setup (resolve DI, open connections, etc.) */
  init(): Promise<void>;

  /** Begin the worker's main loop / subscription. */
  start(): void;

  /** Graceful shutdown — await in-flight work before returning. */
  stop(): Promise<void>;
}
