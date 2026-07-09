import { errorLogger } from "@/utils/winston";

let handlersRegistered = false;

function scheduleFatalExit(): void {
  setImmediate(() => process.exit(1));
}

function getErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export function registerGlobalProcessHandlers(): void {
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;

  process.on("uncaughtException", (error: Error) => {
    errorLogger.error({
      event: "process.uncaught_exception",
      type: "UncaughtException",
      message: error.message,
      stack: error.stack,
    });
    scheduleFatalExit();
  });

  process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
    const details = getErrorDetails(reason);

    errorLogger.error({
      event: "process.unhandled_rejection",
      type: "UnhandledRejection",
      message: details.message,
      stack: details.stack,
      promise: String(promise),
    });
    scheduleFatalExit();
  });
}
