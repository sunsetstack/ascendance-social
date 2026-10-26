import "reflect-metadata";
import { expect } from "chai";
import express, { type RequestHandler } from "express";
import request from "supertest";
import sinon from "sinon";
import { TelemetryRoutes } from "@/routes/telemetry.routes";
import type { TelemetryService } from "@/services/telemetry.service";
import type { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import { logger } from "@/utils/winston";

describe("Feed trace ingestion", () => {
  const previousFlag = process.env.FEED_TRACE_ENABLED;
  let info: sinon.SinonStub;
  let app: express.Express;
  let processEvents: sinon.SinonStub;
  const event = {
    event: "feed.http.failed", at: "2026-10-17T09:00:00.000Z",
    clientRequestId: "action-123", path: "/api/feed/for-you", method: "GET",
    durationMs: 0.0000123456789, message: "Network Error", stack: "Error: Network Error\n" + "    at request (feed.ts:12:3)\n".repeat(180),
  };

  beforeEach(() => {
    process.env.FEED_TRACE_ENABLED = "true";
    info = sinon.stub(logger, "info");
    processEvents = sinon.stub();
    const pass: RequestHandler = (_req, _res, next) => next();
    const routes = new TelemetryRoutes({ processEvents } as unknown as TelemetryService, {
      optional: () => pass, required: () => pass, adminOnly: () => pass,
    } as unknown as AuthMiddlewareService);
    app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/telemetry", routes.getRouter());
  });

  afterEach(() => {
    sinon.restore();
    if (previousFlag === undefined) delete process.env.FEED_TRACE_ENABLED;
    else process.env.FEED_TRACE_ENABLED = previousFlag;
  });

  it("logs bounded browser reports with original precision and stack without processing engagement", async () => {
    await request(app).post("/api/telemetry/feed-trace").send({ events: [event] }).expect(204);
    expect(info.calledOnce).to.equal(true);
    const { stack, ...fields } = event;
    const { error, ...logged } = info.firstCall.args[1];
    expect(info.firstCall.args[0]).to.equal("Browser feed trace");
    expect(logged).to.deep.equal({ ...fields, traceSource: "browser", observedAt: event.at });
    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.equal(event.message);
    expect(error.stack).to.equal(stack);
    expect(processEvents.notCalled).to.equal(true);
  });

  it("rejects unknown fields, unsafe paths and oversized batches without partially logging them", async () => {
    for (const events of [[], Array(26).fill({ ...event, stack: "Error: failed" }), [event, { ...event, body: "private post" }],
      [{ ...event, path: "/api/feed?token=secret" }], [{ ...event, stack: "x".repeat(8193) }]]) {
      await request(app).post("/api/telemetry/feed-trace").send({ events }).expect(400);
    }
    expect(info.notCalled).to.equal(true);
    expect(processEvents.notCalled).to.equal(true);
  });

  it("rejects oversized wire payloads without logging a partial batch", async () => {
    await request(app).post("/api/telemetry/feed-trace").send({ events: Array(25).fill({ ...event, stack: "x".repeat(45_000) }) }).expect(413);
    expect(info.notCalled).to.equal(true);
    expect(processEvents.notCalled).to.equal(true);
  });

  it("disables ingestion when feed tracing is disabled", async () => {
    process.env.FEED_TRACE_ENABLED = "false";
    await request(app).post("/api/telemetry/feed-trace").send({ events: [event] }).expect(404);
    expect(info.notCalled).to.equal(true);
  });

  it("limits report requests per source without logging the rejected request", async () => {
    for (let index = 0; index < 60; index++) {
      await request(app).post("/api/telemetry/feed-trace").send({ events: [event] }).expect(204);
    }
    await request(app).post("/api/telemetry/feed-trace").send({ events: [event] }).expect(429);
    expect(info.callCount).to.equal(60);
  });
});
