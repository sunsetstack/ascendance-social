import "reflect-metadata";
import path from "path";
import dotenv from "dotenv";
import { logger } from "@/utils/winston";
import dns from "node:dns";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import { container } from "tsyringe";
import { setupContainerCore, registerCQRS, initCQRS } from "@/di/container";
import { DatabaseConfig } from "@/config/dbConfig";
import { IpMonitorWorker } from "../workers/_impl/ip-monitor.worker.impl";

const worker = new IpMonitorWorker();

async function start() {
	try {
		// register core DI entries (models, repos, services, controllers, routes)
		setupContainerCore();

		// register CQRS tokens (handler classes) but do not resolve instances yet
		registerCQRS();

		// connect to DB
		const dbConfig = container.resolve(DatabaseConfig);
		await dbConfig.connect();

		// resolve and wire up CQRS handlers
		initCQRS();

		// init and start the worker
		await worker.init();
		worker.start();

		logger.info("IP Monitor worker started successfully");
	} catch (err) {
		logger.error("Worker failed to start", { error: err });
		process.exit(1);
	}
}

start();

// graceful shutdown
async function shutdown() {
	logger.info("Shutting down IP Monitor worker...");
	try {
		await worker.stop?.();
		process.exit(0);
	} catch (err) {
		logger.error("Error during shutdown", { error: err });
		process.exit(1);
	}
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
