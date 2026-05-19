import { container } from "tsyringe";
import { DatabaseConfig } from "@/config/dbConfig";
import { setupContainerCore, registerCQRS, initCQRS } from "@/di/container";
import { logger } from "@/utils/winston";
import { IWorker } from "@/workers/base/IWorker";
import { registerGlobalProcessHandlers } from "@/runtime/process-handlers";

let runtimeInitialized = false;

export async function initializeBackendRuntime(): Promise<void> {
  if (runtimeInitialized) {
    return;
  }

  setupContainerCore();
  registerCQRS();

  const dbConfig = container.resolve(DatabaseConfig);
  await dbConfig.connect();

  initCQRS();
  runtimeInitialized = true;
}

type WorkerEntrypointOptions<TWorker extends IWorker> = {
  workerName: string;
  resolveWorker: () => TWorker;
  startWorker: (worker: TWorker) => Promise<void>;
};

export async function runWorkerEntrypoint<TWorker extends IWorker>({
  workerName,
  resolveWorker,
  startWorker,
}: WorkerEntrypointOptions<TWorker>): Promise<void> {
  registerGlobalProcessHandlers();

  let worker: TWorker | undefined;

  try {
    await initializeBackendRuntime();
    worker = resolveWorker();
    await startWorker(worker);
    logger.info(`${workerName} worker started`);
  } catch (error) {
    logger.error(`${workerName} worker failed to start`, { error });
    process.exit(1);
    return;
  }

  const shutdown = async (signal: string) => {
    logger.info(`Shutting down ${workerName} worker...`, { signal });

    try {
      await worker.stop();
      process.exit(0);
    } catch (error) {
      logger.error(`Error during ${workerName} worker shutdown`, { error });
      process.exit(1);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
