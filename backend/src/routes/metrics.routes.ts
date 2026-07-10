import { Router, RequestHandler } from "express";
import { injectable, inject } from "tsyringe";
import { MetricsService } from "../metrics/metrics.service";
import {
  AuthMiddlewareService,
  adminRateLimit,
} from "../middleware/authentication.middleware";
import { UnitOfWork } from "@/database/UnitOfWork";
import { TransactionQueueService } from "@/services/transaction-queue.service";
import { TOKENS } from "@/types/tokens";

@injectable()
export class MetricsRoutes {
  private readonly router: Router;
  private readonly auth: RequestHandler;
  private readonly adminOnly: RequestHandler;

  constructor(
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
    @inject(TOKENS.Repositories.UnitOfWork)
    private readonly unitOfWork: UnitOfWork,
    @inject(TOKENS.Services.TransactionQueue)
    private readonly transactionQueue: TransactionQueueService,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = Router();
    this.auth = authMiddlewareService.required();
    this.adminOnly = authMiddlewareService.adminOnly();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get("/", async (_req, res) => {
      const metrics = await this.metricsService.getMetrics();
      res.setHeader("Content-Type", this.metricsService.getContentType());
      res.send(metrics);
    });

    this.router.use(this.auth);
    this.router.use(adminRateLimit);
    this.router.use(this.adminOnly);

    // transaction health endpoint for monitoring high-concurrency scenarios
    this.router.get("/transactions", async (_req, res) => {
      const uowMetrics = this.unitOfWork.getMetrics();
      const queueMetrics = await this.transactionQueue.getMetrics();

      res.json({
        unitOfWork: uowMetrics,
        transactionQueue: queueMetrics,
        health: this.calculateHealth(uowMetrics, queueMetrics),
      });
    });
  }

  private calculateHealth(
    uowMetrics: ReturnType<UnitOfWork["getMetrics"]>,
    queueMetrics: Awaited<ReturnType<TransactionQueueService["getMetrics"]>>,
  ): "healthy" | "degraded" | "unhealthy" {
    const failureRate =
      uowMetrics.totalAttempts > 0
        ? uowMetrics.failedTransactions / uowMetrics.totalAttempts
        : 0;

    const queueSize =
      queueMetrics.queueSizes.critical +
      queueMetrics.queueSizes.high +
      queueMetrics.queueSizes.normal +
      queueMetrics.queueSizes.low;

    if (
      failureRate > 0.2 ||
      queueSize > 500 ||
      uowMetrics.availablePermits < 5
    ) {
      return "unhealthy";
    }
    if (
      failureRate > 0.05 ||
      queueSize > 100 ||
      uowMetrics.availablePermits < 20
    ) {
      return "degraded";
    }
    return "healthy";
  }

  public getRouter(): Router {
    return this.router;
  }
}
