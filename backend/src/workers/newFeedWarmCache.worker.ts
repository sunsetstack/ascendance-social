import "reflect-metadata";
import "@/runtime/bootstrap-env";

import { container } from "tsyringe";
import { NewFeedWarmCacheWorker } from "../workers/_impl/newFeedWarmCache.worker.impl";
import { runWorkerEntrypoint } from "@/runtime/backend-runtime";

void runWorkerEntrypoint({
  workerName: "New feed warm cache",
  resolveWorker: () => container.resolve(NewFeedWarmCacheWorker),
  startWorker: async (worker) => {
    await worker.init();
    await worker.start();
  },
});
