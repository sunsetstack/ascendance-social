import "reflect-metadata";
import "@/runtime/bootstrap-env";

import { container } from "tsyringe";
import { ProfileSyncWorker } from "./_impl/profile-sync.worker.impl";
import { runWorkerEntrypoint } from "@/runtime/backend-runtime";

void runWorkerEntrypoint({
  workerName: "Profile sync",
  resolveWorker: () => container.resolve(ProfileSyncWorker),
  startWorker: async (worker) => {
    await worker.start();
  },
});
