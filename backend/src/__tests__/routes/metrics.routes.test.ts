import { describe, it } from "mocha";
import { expect } from "chai";
import express, { RequestHandler } from "express";
import request from "supertest";
import sinon from "sinon";
import { MetricsRoutes } from "@/routes/metrics.routes";

describe("MetricsRoutes", () => {
  function buildApp(authenticated = false) {
    const authRequired: RequestHandler = sinon
      .stub()
      .callsFake((_req, res, next) => {
        if (authenticated) { next(); return; }
        res.status(401).json({ error: "auth required" });
      });

    const adminOnly: RequestHandler = sinon.stub().callsFake((_req, _res, next) => {
      next();
    });

    const metricsService = {
      getMetrics: sinon.stub().resolves("test_metric 1\n"),
      getContentType: sinon
        .stub()
        .returns("text/plain; version=0.0.4; charset=utf-8"),
    };

    const unitOfWork = {
      getMetrics: sinon.stub().returns({
        totalAttempts: 0,
        successfulTransactions: 0,
        failedTransactions: 0,
        retriedTransactions: 0,
        averageRetries: 0,
        availablePermits: 50,
      }),
    };

    const authMiddlewareService = {
      required: () => authRequired,
      adminOnly: () => adminOnly,
    };

    const routes = new MetricsRoutes(
      metricsService as any,
      unitOfWork as any,
      authMiddlewareService as any,
    );

    const app = express();
    app.use("/metrics", routes.getRouter());

    return { app, authRequired, metricsService };
  }

  it("allows Prometheus to scrape metrics without user auth", async () => {
    const { app, authRequired, metricsService } = buildApp();

    const response = await request(app).get("/metrics").expect(200);

    expect(response.text).to.equal("test_metric 1\n");
    expect(metricsService.getMetrics.calledOnce).to.equal(true);
    expect((authRequired as sinon.SinonStub).called).to.equal(false);
  });

  it("keeps transaction diagnostics behind auth", async () => {
    const { app, authRequired } = buildApp();

    await request(app).get("/metrics/transactions").expect(401);

    expect((authRequired as sinon.SinonStub).calledOnce).to.equal(true);
  });

  it("preserves the transaction diagnostics response after retiring the Redis queue", async () => {
    const { app } = buildApp(true);
    const response = await request(app).get("/metrics/transactions").expect(200);
    expect(response.body.health).to.equal("healthy");
    expect(response.body.transactionQueue).to.deep.equal({
      totalEnqueued: 0, totalProcessed: 0, totalFailed: 0, totalDropped: 0,
      queueSizes: { critical: 0, high: 0, normal: 0, low: 0 },
    });
  });
});
