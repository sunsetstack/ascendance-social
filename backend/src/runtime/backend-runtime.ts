import { container } from "tsyringe";
import { DatabaseConfig } from "@/config/dbConfig";
import { setupContainerCore, registerCQRS, initCQRS } from "@/di/container";
import { logger } from "@/utils/winston";
import { IWorker } from "@/workers/base/IWorker";
import { registerGlobalProcessHandlers } from "@/runtime/process-handlers";
import { logNonHttpTerminalError } from "@/runtime/non-http-error-logger";
import { AdminRemovalGuardService } from "@/services/admin-removal-guard.service";
import { TOKENS } from "@/types/tokens";

let runtimeInitialized = false;

export async function initializeBackendRuntime(): Promise<void> {
  if (runtimeInitialized) {
    return;
  }

  setupContainerCore();
  registerCQRS();

  const dbConfig = container.resolve(DatabaseConfig);
  await dbConfig.connect();
  await container
    .resolve<AdminRemovalGuardService>(TOKENS.Services.AdminRemovalGuard)
    .ensureInitialized();

  initCQRS();
  runtimeInitialized = true;
}

type WorkerEntrypointOptions<TWorker extends IWorker> = {
  workerName: string;
  resolveWorker: () => TWorker;
  startWorker: (worker: TWorker) => Promise<void>;
  initializeRuntime?: () => Promise<void>;
};

export async function runWorkerEntrypoint<TWorker extends IWorker>({
  workerName,
  resolveWorker,
  startWorker,
  initializeRuntime = initializeBackendRuntime,
}: WorkerEntrypointOptions<TWorker>): Promise<void> {
  registerGlobalProcessHandlers();

  let worker: TWorker | undefined;

  try {
    await initializeRuntime();
    worker = resolveWorker();
    await startWorker(worker);
    logger.info("Worker started", {
      event: "worker.started",
      worker: workerName,
    });
  } catch (error) {
    logNonHttpTerminalError(error, {
      message: "Worker failed to start",
      event: "worker.start_failed",
      operation: "startup",
      worker: workerName,
    });
    process.exit(1);
    return;
  }

  const shutdown = async (signal: string) => {
    logger.info("Worker shutdown started", {
      event: "worker.shutdown.started",
      worker: workerName,
      signal,
    });

    try {
      await worker.stop();
      logger.info("Worker shutdown completed", {
        event: "worker.shutdown.completed",
        worker: workerName,
        signal,
      });
      process.exit(0);
    } catch (error) {
      logNonHttpTerminalError(error, {
        message: "Worker shutdown failed",
        event: "worker.shutdown.failed",
        operation: "shutdown",
        worker: workerName,
        signal,
      });
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
