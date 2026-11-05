import { Router, RequestHandler } from "express";
import { injectable, inject } from "tsyringe";
import { MetricsService } from "../metrics/metrics.service";
import {
  AuthMiddlewareService,
  adminRateLimit,
} from "../middleware/authentication.middleware";
import { UnitOfWork } from "@/database/UnitOfWork";
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
      res.json({
        unitOfWork: uowMetrics,
        // Keep the diagnostics contract; refresh delivery is tracked by the outbox.
        transactionQueue: {
          totalEnqueued: 0,
          totalProcessed: 0,
          totalFailed: 0,
          totalDropped: 0,
          queueSizes: { critical: 0, high: 0, normal: 0, low: 0 },
        },
        health: this.calculateHealth(uowMetrics),
      });
    });
  }

  private calculateHealth(
    uowMetrics: ReturnType<UnitOfWork["getMetrics"]>,
  ): "healthy" | "degraded" | "unhealthy" {
    const failureRate =
      uowMetrics.totalAttempts > 0
        ? uowMetrics.failedTransactions / uowMetrics.totalAttempts
        : 0;

    if (
      failureRate > 0.2 ||
      uowMetrics.availablePermits < 5
    ) {
      return "unhealthy";
    }
    if (
      failureRate > 0.05 ||
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
