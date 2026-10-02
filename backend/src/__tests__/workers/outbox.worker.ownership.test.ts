import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import type { IOutboxEvent } from "@/models/outbox.model";
import { errorLogger, logger } from "@/utils/winston";
import {
  TestEvent,
  createRecord,
  nextRecord,
} from "../helpers/outbox-fixtures";
import {
  createOutboxWorkerHarness,
  type OutboxWorkerHarness,
  terminalLogSchema,
  logArguments,
} from "../helpers/outbox-worker-harness";

describe("OutboxWorker ownership", () => {
  let harness: OutboxWorkerHarness;
  beforeEach(() => {
    harness = createOutboxWorkerHarness();
  });
  afterEach(async () => harness.cleanup());

  it("stops handlers on a lost checkpoint and continues with the next event", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;
    let records: IOutboxEvent[];

    const terminalLogger = sandbox.stub(errorLogger, "error");
    const warningLogger = sandbox.stub(logger, "warn");
    const handleSpy = sandbox.stub<[unknown], Promise<void>>().resolves();
    const laterHandleSpy = sandbox.stub<[unknown], Promise<void>>().resolves();
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
      { key: "SecondTestEventHandler", handle: laterHandleSpy },
    ]);

    records = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 0,
        traceId: "trace-1",
        processedHandlers: [],
      }),
    ];
    records.push(nextRecord());
    arrangeClaims([records[0]], [records[1]], []);
    outboxRepository.markHandlerProcessed.onFirstCall().resolves(false);
    outboxRepository.markAsFailed.resolves(false);

    await outboxWorker.runTick();

    const workerId = assertClaims(3);
    expect(handleSpy.getCalls().map(({ args }) => args)).to.deep.equal([
      [new TestEvent("first")],
      [new TestEvent("second")],
    ]);
    sinon.assert.calledOnceWithExactly(laterHandleSpy, new TestEvent("second"));
    expect(
      outboxRepository.markHandlerProcessed.getCalls().map(({ args }) => args),
    ).to.deep.equal([
      ["507f1f77bcf86cd799439011", "TestEventHandler", workerId],
      ["507f1f77bcf86cd799439012", "TestEventHandler", workerId],
      ["507f1f77bcf86cd799439012", "SecondTestEventHandler", workerId],
    ]);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsProcessed,
      "507f1f77bcf86cd799439012",
      workerId,
    );
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsFailed,
      "507f1f77bcf86cd799439011",
      "Outbox event ownership lost before handler checkpoint",
      workerId,
      {
        nextAttemptAt: new Date(Date.now() + 15_000),
        exhaustedAt: undefined,
      },
    );
    sinon.assert.calledOnce(terminalLogger);
    sinon.assert.calledOnce(warningLogger);
    const terminalRecord = terminalLogSchema.parse(
      terminalLogger.firstCall.args[0],
    );
    expect(
      terminalRecord.breadcrumbs.map(({ event }: { event: string }) => event),
    ).to.include("worker.outbox.processing.failed");
    expect(
      terminalRecord.breadcrumbs.map(({ event }: { event: string }) => event),
    ).not.to.include("worker.outbox.handler.failed");
    expect(
      terminalRecord.breadcrumbs.map(({ event }: { event: string }) => event),
    ).not.to.include("worker.outbox.retry.scheduled");
  });

  it("does not report success when ownership is lost before completion", async () => {
    const {
      eventBus,
      outboxRepository,
      metricsService,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;
    let records: IOutboxEvent[];

    const handleSpy = sandbox.stub<[unknown], Promise<void>>().resolves();
    const terminalLogger = sandbox.stub(errorLogger, "error");
    const infoLogger = sandbox.stub(logger, "info");
    const warningLogger = sandbox.stub(logger, "warn");
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);
    records = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 0,
        traceId: "trace-1",
        processedHandlers: [],
      }),
    ];
    records.push(nextRecord());
    arrangeClaims([records[0]], [records[1]], []);
    outboxRepository.markAsProcessed.onFirstCall().resolves(false);
    outboxRepository.markAsFailed.resolves(false);

    await outboxWorker.runTick();

    const workerId = assertClaims(3);
    expect(handleSpy.getCalls().map(({ args }) => args)).to.deep.equal([
      [new TestEvent("first")],
      [new TestEvent("second")],
    ]);
    expect(
      outboxRepository.markHandlerProcessed.getCalls().map(({ args }) => args),
    ).to.deep.equal([
      ["507f1f77bcf86cd799439011", "TestEventHandler", workerId],
      ["507f1f77bcf86cd799439012", "TestEventHandler", workerId],
    ]);
    expect(
      outboxRepository.markAsProcessed.getCalls().map(({ args }) => args),
    ).to.deep.equal([
      ["507f1f77bcf86cd799439011", workerId],
      ["507f1f77bcf86cd799439012", workerId],
    ]);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsFailed,
      "507f1f77bcf86cd799439011",
      "Outbox event ownership lost before completion",
      workerId,
      {
        nextAttemptAt: new Date(Date.now() + 15_000),
        exhaustedAt: undefined,
      },
    );
    expect(
      metricsService.recordOutboxAttempt.getCalls().map(({ args }) => args),
    ).to.deep.equal([
      ["TestEvent", "failed", 0],
      ["TestEvent", "processed", 0],
    ]);
    sinon.assert.calledOnce(terminalLogger);
    sinon.assert.calledOnce(warningLogger);
    sinon.assert.calledOnce(infoLogger);
    expect(logArguments(infoLogger.firstCall)[1]).to.include({
      event: "outbox.event.processed",
      eventId: "507f1f77bcf86cd799439012",
    });
    const order = [
      handleSpy.firstCall,
      outboxRepository.markHandlerProcessed.firstCall,
      outboxRepository.markAsProcessed.firstCall,
      outboxRepository.markAsFailed.firstCall,
      outboxRepository.claimPendingEvents.secondCall,
    ];
    for (let index = 1; index < order.length; index++) {
      expect(order[index - 1].calledBefore(order[index])).to.equal(true);
    }
  });

  it("warns when an ownership-qualified failure write is rejected and continues", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;
    let records: IOutboxEvent[];

    outboxRepository.markAsFailed.resolves(false);
    const terminalLogger = sandbox.stub(errorLogger, "error");
    const warningLogger = sandbox.stub(logger, "warn");
    const handleSpy = sandbox
      .stub<[unknown], Promise<void>>()
      .callsFake(async (event) => {
        if (!(event instanceof TestEvent))
          throw new Error("Expected a TestEvent payload");
        if (event.payload === "first") {
          throw new Error("Handler failed");
        }
      });
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);

    records = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 0,
        traceId: "trace-1",
        processedHandlers: [],
      }),
    ];

    records.push(nextRecord());
    arrangeClaims([records[0]], [records[1]], []);
    await outboxWorker.runTick();

    const workerId = assertClaims(3);
    expect(handleSpy.getCalls().map(({ args }) => args)).to.deep.equal([
      [new TestEvent("first")],
      [new TestEvent("second")],
    ]);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markHandlerProcessed,
      "507f1f77bcf86cd799439012",
      "TestEventHandler",
      workerId,
    );
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsProcessed,
      "507f1f77bcf86cd799439012",
      workerId,
    );
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsFailed,
      "507f1f77bcf86cd799439011",
      "Handler failed",
      workerId,
      {
        nextAttemptAt: new Date(Date.now() + 15_000),
        exhaustedAt: undefined,
      },
    );
    sinon.assert.calledOnce(terminalLogger);
    sinon.assert.calledOnce(warningLogger);
    const terminalRecord = terminalLogSchema.parse(
      terminalLogger.firstCall.args[0],
    );
    const warningRecord = logArguments(warningLogger.firstCall)[1];
    expect(
      terminalRecord.breadcrumbs.map(({ event }: { event: string }) => event),
    ).not.to.include("worker.outbox.retry.scheduled");
    expect(warningRecord).to.deep.include({
      event: "outbox.event.ownership_lost",
    });
  });
});
