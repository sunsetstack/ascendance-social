import "reflect-metadata";
import "@/runtime/bootstrap-env";

import { container } from "tsyringe";
import { IpMonitorWorker } from "../workers/_impl/ip-monitor.worker.impl";
import { runWorkerEntrypoint } from "@/runtime/backend-runtime";

void runWorkerEntrypoint({
  workerName: "IP monitor",
  resolveWorker: () => container.resolve(IpMonitorWorker),
  startWorker: async (worker) => {
    await worker.start();
  },
});
