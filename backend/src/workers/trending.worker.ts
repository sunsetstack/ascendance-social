import "reflect-metadata";
import "@/runtime/bootstrap-env";

import { container } from "tsyringe";
import { TrendingWorker } from "../workers/_impl/trending.worker.impl";
import { runWorkerEntrypoint } from "@/runtime/backend-runtime";

void runWorkerEntrypoint({
  workerName: "Trending",
  resolveWorker: () => container.resolve(TrendingWorker),
  startWorker: async (worker) => {
    await worker.init();
    await worker.start();
  },
});
