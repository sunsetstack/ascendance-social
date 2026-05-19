import { injectable } from "tsyringe";
import client from "prom-client";
import type { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * manages prometheus metrics for the backend including http requests,
 *  worker status, and external service health
 */
@injectable()
export class MetricsService {
	private readonly registry: client.Registry;
	private readonly httpDuration: client.Histogram<string>;
	private readonly httpRequestsTotal: client.Counter<string>;
	private readonly workerStatus: client.Gauge<string>;
	private readonly workerRestarts: client.Counter<string>;
	private readonly redisUp: client.Gauge<string>;
	private readonly optionalAuthFailuresTotal: client.Counter<string>;
	private readonly outboxPendingEvents: client.Gauge<string>;
	private readonly outboxEventsTotal: client.Counter<string>;
	private readonly outboxBatchSize: client.Histogram<string>;
	private readonly outboxEventDuration: client.Histogram<string>;

	constructor() {
		this.registry = new client.Registry();
		this.registry.setDefaultLabels({ service: "backend" });

		// prom-client starts an interval timer for default metrics collection
		// which keeps the event loop alive and can make Mocha hang at the end of the suite
		if (process.env.NODE_ENV !== "test") {
			client.collectDefaultMetrics({
				register: this.registry,
				eventLoopMonitoringPrecision: 10,
			});
		}

		this.httpDuration = new client.Histogram({
			name: "http_request_duration_seconds",
			help: "HTTP request latency",
			labelNames: ["method", "route", "status"],
			buckets: [0.05, 0.1, 0.2, 0.5, 1, 2, 5],
			registers: [this.registry],
		});

		this.httpRequestsTotal = new client.Counter({
			name: "http_requests_total",
			help: "Total HTTP requests",
			labelNames: ["method", "route", "status"],
			registers: [this.registry],
		});

		this.workerStatus = new client.Gauge({
			name: "worker_thread_status",
			help: "Worker thread state (1 running, 0 stopped)",
			labelNames: ["worker"],
			registers: [this.registry],
		});

		this.workerRestarts = new client.Counter({
			name: "worker_thread_restarts_total",
			help: "Worker thread restart count",
			labelNames: ["worker"],
			registers: [this.registry],
		});

		this.redisUp = new client.Gauge({
			name: "redis_connection_up",
			help: "Redis connection state (1 up, 0 down)",
			registers: [this.registry],
		});

		this.optionalAuthFailuresTotal = new client.Counter({
			name: "auth_optional_failures_total",
			help: "Optional-auth failures by reason and route",
			labelNames: ["reason", "route"],
			registers: [this.registry],
		});

		this.outboxPendingEvents = new client.Gauge({
			name: "outbox_pending_events",
			help: "Outbox events waiting to be dispatched",
			registers: [this.registry],
		});

		this.outboxEventsTotal = new client.Counter({
			name: "outbox_events_total",
			help: "Outbox event processing attempts grouped by event type and outcome",
			labelNames: ["event_type", "status"],
			registers: [this.registry],
		});

		this.outboxBatchSize = new client.Histogram({
			name: "outbox_batch_size",
			help: "Number of outbox records fetched per worker tick",
			buckets: [0, 1, 5, 10, 25, 50, 100],
			registers: [this.registry],
		});

		this.outboxEventDuration = new client.Histogram({
			name: "outbox_event_processing_duration_seconds",
			help: "Outbox event processing duration by event type and outcome",
			labelNames: ["event_type", "status"],
			buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
			registers: [this.registry],
		});
	}

	public httpMetricsMiddleware(): RequestHandler {
		return (req: Request, res: Response, next: NextFunction) => {
			const stopTimer = this.httpDuration.startTimer();
			res.once("finish", () => {
				const route = this.normalizeRoute(req);
				const status = String(res.statusCode);
				this.httpRequestsTotal.labels(req.method, route, status).inc();
				stopTimer({ method: req.method, route, status });
			});
			next();
		};
	}

	public async getMetrics(): Promise<string> {
		return await this.registry.metrics();
	}

	public getContentType(): string {
		return this.registry.contentType;
	}

	public markWorkerRunning(worker: string): void {
		this.workerStatus.labels(worker).set(1);
	}

	public markWorkerStopped(worker: string): void {
		this.workerStatus.labels(worker).set(0);
	}

	public markWorkerCrashed(worker: string): void {
		this.workerStatus.labels(worker).set(0);
		this.workerRestarts.labels(worker).inc();
	}

	public setRedisConnectionState(up: boolean): void {
		this.redisUp.set(up ? 1 : 0);
	}

	public recordOptionalAuthFailure(reason: string, route: string): void {
		this.optionalAuthFailuresTotal.labels(reason || "unknown", route || "unknown").inc();
	}

	public setOutboxPendingCount(count: number): void {
		this.outboxPendingEvents.set(Math.max(0, count));
	}

	public recordOutboxBatchSize(size: number): void {
		this.outboxBatchSize.observe(Math.max(0, size));
	}

	public recordOutboxAttempt(
		eventType: string,
		status: "processed" | "failed",
		durationMs: number,
	): void {
		const normalizedEventType = eventType || "unknown";
		const normalizedDurationSeconds = Math.max(0, durationMs) / 1000;

		this.outboxEventsTotal.labels(normalizedEventType, status).inc();
		this.outboxEventDuration
			.labels(normalizedEventType, status)
			.observe(normalizedDurationSeconds);
	}

	/**
	 * Generic counter increment method for custom metrics.
	 * Creates a counter if it doesn't exist.
	 */
	public incrementCounter(name: string, labels: Record<string, string> = {}): void {
		const labelNames = Object.keys(labels);
		const labelValues = Object.values(labels);

		// Try to find existing counter
		const existing = this.registry.getSingleMetric(name);
		
		if (existing && existing instanceof client.Counter) {
			existing.labels(...labelValues).inc();
		} else if (!existing) {
			// Create new counter if it doesn't exist
			const counter = new client.Counter({
				name,
				help: `Dynamic counter: ${name}`,
				labelNames,
				registers: [this.registry],
			});
			counter.labels(...labelValues).inc();
		}
	}

	private normalizeRoute(req: Request): string {
		const path = this.composeRoute(req);
		return path.replace(/[0-9a-fA-F]{8,}/g, ":id").replace(/\d+/g, ":id");
	}

	private composeRoute(req: Request): string {
		if (req.route?.path) {
			return `${req.baseUrl}${req.route.path}` || "/";
		}
		const raw = req.baseUrl || req.path || req.originalUrl || "/";
		const [pathOnly] = raw.split("?");
		return pathOnly || "/";
	}
}
