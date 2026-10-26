import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import type { IOutboxEvent } from "@/models/outbox.model";
import { errorLogger, logger } from "@/utils/winston";
import {
  TestEvent,
  createRecord,
  createDeferred,
} from "../helpers/outbox-fixtures";
import {
  createOutboxWorkerHarness,
  type OutboxWorkerHarness,
  logArguments,
} from "../helpers/outbox-worker-harness";

describe("OutboxWorker core processing", () => {
  let harness: OutboxWorkerHarness;
  beforeEach(() => {
    harness = createOutboxWorkerHarness();
  });
  afterEach(async () => harness.cleanup());

  it("awaits each handler and its checkpoint before starting the next handler", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;

    const record = createRecord({ _id: "507f1f77bcf86cd799439011" });
    arrangeClaims([record], []);
    const handlerEntered = createDeferred<void>();
    const handlerRelease = createDeferred<void>();
    const checkpointEntered = createDeferred<void>();
    const checkpointRelease = createDeferred<boolean>();
    const first = sandbox
      .stub<[unknown], Promise<void>>()
      .callsFake(async () => {
        handlerEntered.resolve();
        await handlerRelease.promise;
      });
    const second = sandbox.stub<[unknown], Promise<void>>().resolves();
    eventBus.getRegisteredHandlers.returns([
      { key: "first", handle: first },
      { key: "second", handle: second },
    ]);
    outboxRepository.markHandlerProcessed.onFirstCall().callsFake(async () => {
      checkpointEntered.resolve();
      return checkpointRelease.promise;
    });
    const tick = outboxWorker.runTick();
    try {
      await handlerEntered.promise;
      sinon.assert.notCalled(second);
      sinon.assert.notCalled(outboxRepository.markHandlerProcessed);
      handlerRelease.resolve();
      await checkpointEntered.promise;
      sinon.assert.notCalled(second);
      sinon.assert.notCalled(outboxRepository.markAsProcessed);
      checkpointRelease.resolve(true);
      await tick;
      const owner = assertClaims(2);
      expect(
        outboxRepository.markHandlerProcessed
          .getCalls()
          .map(({ args }) => args),
      ).to.deep.equal([
        [String(record._id), "first", owner],
        [String(record._id), "second", owner],
      ]);
      sandbox.assert.callOrder(
        first,
        outboxRepository.markHandlerProcessed,
        second,
        outboxRepository.markAsProcessed,
      );
      sinon.assert.calledOnceWithExactly(second, record.payload);
    } finally {
      handlerRelease.resolve();
      checkpointRelease.resolve(true);
      await tick;
    }
  });

  it("should process unprocessed events and mark them as processed", async () => {
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

    outboxRepository.getBacklogStats.resolves({
      pendingCount: 0,
      exhaustedCount: 0,
    });
    outboxRepository.getBacklogStats
      .onFirstCall()
      .resolves({ pendingCount: 2, exhaustedCount: 0 });
    const infoLogger = sandbox.stub(logger, "info");
    const handleSpy = sandbox.stub<[unknown], Promise<void>>().resolves();
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);

    const mockEvents = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 0,
        traceId: "trace-1",
        processedHandlers: [],
      }),
      createRecord({
        _id: "507f1f77bcf86cd799439012",
        eventType: "TestEvent",
        payload: new TestEvent("second"),
        retries: 0,
        traceId: "trace-2",
        processedHandlers: [],
      }),
    ];
    records = mockEvents;
    arrangeClaims(...mockEvents.map((record) => [record]), []);

    await outboxWorker.runTick();

    expect(metricsService.setOutboxPendingCount.firstCall.args[0]).to.equal(2);
    expect(metricsService.recordOutboxBatchSize.calledOnceWithExactly(2)).to.be
      .true;
    const workerId = assertClaims(3);
    expect(handleSpy.calledTwice).to.be.true;
    expect(handleSpy.firstCall.args[0]).to.deep.equal(new TestEvent("first"));
    expect(handleSpy.secondCall.args[0]).to.deep.equal(new TestEvent("second"));

    expect(outboxRepository.markHandlerProcessed.calledTwice).to.be.true;
    expect(
      outboxRepository.markHandlerProcessed.firstCall.calledWithExactly(
        "507f1f77bcf86cd799439011",
        "TestEventHandler",
        workerId,
      ),
    ).to.be.true;
    expect(
      outboxRepository.markHandlerProcessed.secondCall.calledWithExactly(
        "507f1f77bcf86cd799439012",
        "TestEventHandler",
        workerId,
      ),
    ).to.be.true;
    expect(outboxRepository.markAsProcessed.calledTwice).to.be.true;
    expect(
      outboxRepository.markAsProcessed.getCalls().map(({ args }) => args),
    ).to.deep.equal([
      ["507f1f77bcf86cd799439011", workerId],
      ["507f1f77bcf86cd799439012", workerId],
    ]);
    const processingOrder = [
      handleSpy.getCall(0),
      outboxRepository.markHandlerProcessed.getCall(0),
      outboxRepository.markAsProcessed.getCall(0),
      outboxRepository.claimPendingEvents.getCall(1),
      handleSpy.getCall(1),
      outboxRepository.markHandlerProcessed.getCall(1),
      outboxRepository.markAsProcessed.getCall(1),
      outboxRepository.claimPendingEvents.getCall(2),
    ];
    for (let index = 1; index < processingOrder.length; index++) {
      expect(
        processingOrder[index - 1].calledBefore(processingOrder[index]),
      ).to.equal(true);
    }
    expect(outboxRepository.markAsFailed.called).to.be.false;
    expect(metricsService.recordOutboxAttempt.calledTwice).to.be.true;
    expect(metricsService.recordOutboxAttempt.firstCall.args[0]).to.equal(
      "TestEvent",
    );
    expect(metricsService.recordOutboxAttempt.firstCall.args[1]).to.equal(
      "processed",
    );
    expect(metricsService.setOutboxPendingCount.secondCall.args[0]).to.equal(0);
    const terminalRecord = logArguments(infoLogger.lastCall)[1];
    expect(terminalRecord).to.have.property("event", "outbox.event.processed");
    expect(terminalRecord).not.to.have.property("breadcrumbs");
    await outboxWorker.runTick();
    assertClaims(3);
    sinon.assert.calledTwice(handleSpy);
  });

  it("should continue processing later events when an earlier event fails", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;
    let records: IOutboxEvent[];

    const handleSpy = sandbox
      .stub<[unknown], Promise<void>>()
      .callsFake(async (event) => {
        if (!(event instanceof TestEvent))
          throw new Error("Expected a TestEvent payload");
        if (event.payload === "first") {
          throw new Error("first failed");
        }
      });
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);

    const mockEvents = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 0,
        traceId: "trace-1",
        processedHandlers: [],
      }),
      createRecord({
        _id: "507f1f77bcf86cd799439012",
        eventType: "TestEvent",
        payload: new TestEvent("second"),
        retries: 0,
        traceId: "trace-2",
        processedHandlers: [],
      }),
    ];
    records = mockEvents;
    arrangeClaims(...mockEvents.map((record) => [record]), []);

    await outboxWorker.runTick();

    const workerId = assertClaims(3);
    expect(handleSpy.calledTwice).to.be.true;
    expect(handleSpy.getCalls().map(({ args }) => args)).to.deep.equal([
      [new TestEvent("first")],
      [new TestEvent("second")],
    ]);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsFailed,
      "507f1f77bcf86cd799439011",
      "first failed",
      workerId,
      {
        nextAttemptAt: new Date(Date.now() + 15_000),
        exhaustedAt: undefined,
      },
    );
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
    expect(
      outboxRepository.markAsFailed.firstCall.calledBefore(
        outboxRepository.claimPendingEvents.secondCall,
      ),
    ).to.equal(true);
  });

  it("should resume from the first unprocessed handler on retry", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;
    let records: IOutboxEvent[];

    const clock = sandbox.clock;
    sandbox.stub(errorLogger, "error");
    const firstHandleSpy = sandbox.stub<[unknown], Promise<void>>().resolves();
    const secondHandleSpy = sandbox.stub<[unknown], Promise<void>>().resolves();
    secondHandleSpy.onFirstCall().rejects(new Error("second failed"));
    eventBus.getRegisteredHandlers.returns([
      { key: "FirstTestEventHandler", handle: firstHandleSpy },
      { key: "SecondTestEventHandler", handle: secondHandleSpy },
    ]);

    const record = createRecord({
      _id: "507f1f77bcf86cd799439011",
      eventType: "TestEvent",
      payload: new TestEvent("resume"),
      retries: 0,
      traceId: "trace-1",
      processedHandlers: [],
    });

    records = [record];
    arrangeClaims([record], []);

    await outboxWorker.runTick();

    const workerId = assertClaims(2);
    sinon.assert.calledOnceWithExactly(firstHandleSpy, record.payload);
    sinon.assert.calledOnceWithExactly(secondHandleSpy, record.payload);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markHandlerProcessed,
      "507f1f77bcf86cd799439011",
      "FirstTestEventHandler",
      workerId,
    );
    sinon.assert.notCalled(outboxRepository.markAsProcessed);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsFailed,
      "507f1f77bcf86cd799439011",
      "second failed",
      workerId,
      {
        nextAttemptAt: new Date(Date.now() + 15_000),
        exhaustedAt: undefined,
      },
    );
    expect(record.processedHandlers).to.deep.equal([]);
    const [firstClaim] =
      await outboxRepository.claimPendingEvents.firstCall.returnValue;
    expect(firstClaim).to.equal(record);
    expect(firstClaim.retries).to.equal(0);
    expect(firstClaim.processedHandlers).to.deep.equal([]);
    expect(record.retries).to.equal(0);
    const nextAttemptAt =
      outboxRepository.markAsFailed.firstCall.args[3]!.nextAttemptAt!;
    expect(nextAttemptAt.getTime()).to.be.greaterThan(Date.now());

    clock.setSystemTime(nextAttemptAt.getTime() - 1);
    arrangeClaims([]);
    await outboxWorker.runTick();
    assertClaims(3);
    sinon.assert.calledOnce(firstHandleSpy);
    sinon.assert.calledOnce(secondHandleSpy);

    clock.setSystemTime(nextAttemptAt);
    const retryRecord = createRecord({
      _id: String(record._id),
      eventType: record.eventType,
      payload: record.payload,
      retries: 1,
      traceId: record.traceId,
      processedHandlers: ["FirstTestEventHandler"],
    });
    arrangeClaims([retryRecord], []);
    await outboxWorker.runTick();

    assertClaims(5);
    const [retryClaim] =
      await outboxRepository.claimPendingEvents.getCall(3).returnValue;
    expect(retryClaim).not.to.equal(record);
    expect(retryClaim.retries).to.equal(1);
    expect(retryClaim.processedHandlers).to.deep.equal([
      "FirstTestEventHandler",
    ]);
    sinon.assert.calledOnceWithExactly(firstHandleSpy, record.payload);
    sinon.assert.calledTwice(secondHandleSpy);
    expect(secondHandleSpy.secondCall.args).to.deep.equal([record.payload]);
    expect(
      outboxRepository.markHandlerProcessed.getCalls().map(({ args }) => args),
    ).to.deep.equal([
      ["507f1f77bcf86cd799439011", "FirstTestEventHandler", workerId],
      ["507f1f77bcf86cd799439011", "SecondTestEventHandler", workerId],
    ]);
    sinon.assert.calledOnce(outboxRepository.markAsFailed);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsProcessed,
      "507f1f77bcf86cd799439011",
      workerId,
    );
    expect(
      outboxRepository.markHandlerProcessed.secondCall.calledBefore(
        outboxRepository.markAsProcessed.firstCall,
      ),
    ).to.equal(true);
  });
});
