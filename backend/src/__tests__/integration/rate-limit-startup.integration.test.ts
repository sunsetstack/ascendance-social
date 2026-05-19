import "reflect-metadata";
import { describe, it, afterEach } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import express from "express";
import request from "supertest";

describe("Rate limit startup integration", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("does not connect Redis during startup and initializes the rate-limit client on first request", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const redisModule = require("redis") as typeof import("redis");

    const connectStub = sinon.stub().resolves();
    const sendCommandStub = sinon
      .stub()
      .rejects(new Error("rate-limit redis unavailable"));

    const fakeClient = {
      on: sinon.stub().returnsThis(),
      connect: connectStub,
      sendCommand: sendCommandStub,
    };

    const createClientStub = sinon
      .stub(redisModule, "createClient")
      .returns(fakeClient as any);

    const { container } = require("tsyringe") as typeof import("tsyringe");
    const { TOKENS } =
      require("@/types/tokens") as typeof import("@/types/tokens");
    const { Server } =
      require("@/server/server") as typeof import("@/server/server");

    const commandBus = {
      dispatch: sinon.stub().resolves(),
    };
    container.registerInstance(TOKENS.CQRS.Commands.Bus, commandBus as any);

    const routeStub = {
      getRouter: () => express.Router(),
    };

    const metricsService = {
      httpMetricsMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
      incrementCounter: sinon.stub(),
    };

    try {
      const server = new Server(
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        routeStub as any,
        metricsService as any,
        routeStub as any,
        routeStub as any,
      );

      const app = server.getExpressApp();

      expect(createClientStub.called).to.be.false;
      expect(connectStub.called).to.be.false;
      expect(sendCommandStub.called).to.be.false;

      const healthResponse = await request(app).get("/health").expect(200);
      expect(healthResponse.body.status).to.equal("ok");
      expect(createClientStub.called).to.be.false;
      expect(connectStub.called).to.be.false;
      expect(sendCommandStub.called).to.be.false;

      const missingResponse = await request(app)
        .get("/definitely-missing")
        .expect(404);
      expect(missingResponse.body).to.deep.equal({ error: "Route not found" });
      expect(createClientStub.calledOnce).to.be.true;
      expect(connectStub.calledOnce).to.be.true;
      expect(sendCommandStub.called).to.be.true;
      expect(commandBus.dispatch.calledOnce).to.be.true;
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
