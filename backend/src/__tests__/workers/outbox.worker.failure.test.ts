import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { MAX_OUTBOX_RETRIES } from "@/repositories/outbox.repository";
import type { IOutboxEvent } from "@/models/outbox.model";
import { getRequestContext } from "@/runtime/request-context";
import { errorLogger, logger } from "@/utils/winston";
import { TestEvent, createRecord } from "../helpers/outbox-fixtures";
import {
  createOutboxWorkerHarness,
  type OutboxWorkerHarness,
  terminalLogSchema,
} from "../helpers/outbox-worker-harness";

describe("OutboxWorker failures", () => {
  let harness: OutboxWorkerHarness;
  beforeEach(() => {
    harness = createOutboxWorkerHarness();
  });
  afterEach(async () => harness.cleanup());

  it("adds retry jitter within a bounded twenty-percent window", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      random,
      sandbox,
      arrangeClaims,
    } = harness;
    let records: IOutboxEvent[];

    process.env.OUTBOX_RETRY_BASE_DELAY_MS = "5000";
    process.env.OUTBOX_RETRY_MAX_DELAY_MS = "10000";
    const handleSpy = sandbox
      .stub<[unknown], Promise<void>>()
      .rejects(new Error("retry"));
    sandbox.stub(errorLogger, "error");
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);
    for (const [randomValue, expectedDelay] of [
      [0, 4000],
      [1, 6000],
    ]) {
      random.returns(randomValue);
      records = [
        createRecord({
          _id: "507f1f77bcf86cd799439011",
          eventType: "TestEvent",
          payload: new TestEvent("retry"),
          retries: 0,
          traceId: "trace-1",
          processedHandlers: [],
        }),
      ];
      arrangeClaims([records[0]], []);
      await outboxWorker.runTick();
      expect(outboxRepository.markAsFailed.lastCall.args).to.deep.equal([
        String(records[0]._id),
        "retry",
        outboxRepository.claimPendingEvents.firstCall.args[1],
        {
          nextAttemptAt: new Date(Date.now() + expectedDelay),
          exhaustedAt: undefined,
        },
      ]);
    }
  });

  it("should mark event as failed if handler throws an error", async () => {
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

    const terminalLogger = sandbox.stub(errorLogger, "error");
    const failureTime = Date.parse("2026-07-30T12:00:00.000Z");
    expect(Date.now()).to.equal(failureTime);
    let breadcrumbsAtMark: string[] | undefined;
    const handleSpy = sandbox
      .stub<[unknown], Promise<void>>()
      .rejects(new Error("Handler failed"));
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);

    const mockEvents = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 2,
        traceId: "trace-1",
        processedHandlers: [],
      }),
    ];
    records = mockEvents;
    arrangeClaims(...mockEvents.map((record) => [record]), []);
    outboxRepository.markAsFailed.callsFake(async () => {
      breadcrumbsAtMark = getRequestContext()?.breadcrumbs.map(
        ({ event }) => event,
      );
      return true;
    });

    await outboxWorker.runTick();

    expect(handleSpy.calledOnce).to.be.true;
    const workerId = assertClaims(2);
    expect(outboxRepository.markAsProcessed.called).to.be.false;
    expect(outboxRepository.markHandlerProcessed.called).to.be.false;
    expect(outboxRepository.markAsFailed.calledOnce).to.be.true;
    expect(outboxRepository.markAsFailed.firstCall.args[0]).to.equal(
      "507f1f77bcf86cd799439011",
    );
    expect(outboxRepository.markAsFailed.firstCall.args[1]).to.equal(
      "Handler failed",
    );
    expect(outboxRepository.markAsFailed.firstCall.args[2]).to.equal(workerId);
    expect(outboxRepository.markAsFailed.firstCall.args[3]).to.deep.equal({
      nextAttemptAt: new Date(failureTime + 60_000),
      exhaustedAt: undefined,
    });
    expect(metricsService.recordOutboxAttempt.calledOnce).to.be.true;
    expect(metricsService.recordOutboxAttempt.firstCall.args[1]).to.equal(
      "failed",
    );
    expect(breadcrumbsAtMark).to.deep.equal([
      "worker.outbox.received",
      "worker.outbox.handler.enter",
      "worker.outbox.handler.failed",
      "worker.outbox.retry.requested",
    ]);
    sinon.assert.calledOnce(terminalLogger);
    const terminalRecord = terminalLogSchema.parse(
      terminalLogger.firstCall.args[0],
    );
    expect(
      terminalRecord.breadcrumbs.map(({ event }: { event: string }) => event),
    ).to.deep.equal([
      "worker.outbox.received",
      "worker.outbox.handler.enter",
      "worker.outbox.handler.failed",
      "worker.outbox.retry.requested",
      "worker.outbox.retry.scheduled",
    ]);
    expect(
      terminalRecord.breadcrumbs.every(
        ({ offsetMs }: { offsetMs?: number }) => typeof offsetMs === "number",
      ),
    ).to.equal(true);
    expect(terminalRecord).to.have.property("message", "Outbox event failed");
    sandbox.assert.callOrder(
      metricsService.recordOutboxAttempt,
      outboxRepository.markAsFailed,
    );
  });

  it("marks exhausted events, updates the metric, and emits replay guidance", async () => {
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

    const now = Date.parse("2026-07-30T12:00:00.000Z");
    const createdAt = new Date(now - 90_000);
    expect(Date.now()).to.equal(now);
    const handleSpy = sandbox
      .stub<[unknown], Promise<void>>()
      .rejects(new Error("terminal handler failure"));
    eventBus.getRegisteredHandlers.returns([
      { key: "TestEventHandler", handle: handleSpy },
    ]);
    const exhaustionLog = sandbox.stub(logger, "error");
    sandbox.stub(errorLogger, "error");
    records = [
      createRecord({
        _id: "507f1f77bcf86cd799439011",
        createdAt,
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        processedHandlers: [],
        retries: MAX_OUTBOX_RETRIES - 1,
        traceId: "trace-1",
      }),
    ];

    arrangeClaims([records[0]], []);
    outboxRepository.getBacklogStats
      .onSecondCall()
      .resolves({ pendingCount: 0, exhaustedCount: 1 });
    await outboxWorker.runTick();

    const workerId = assertClaims(2);
    sinon.assert.calledOnceWithExactly(handleSpy, new TestEvent("first"));
    sinon.assert.notCalled(outboxRepository.markHandlerProcessed);
    sinon.assert.notCalled(outboxRepository.markAsProcessed);
    sinon.assert.calledOnceWithExactly(
      outboxRepository.markAsFailed,
      "507f1f77bcf86cd799439011",
      "terminal handler failure",
      workerId,
      { nextAttemptAt: undefined, exhaustedAt: new Date(now) },
    );
    const failureState = outboxRepository.markAsFailed.firstCall.args[3];
    if (!failureState) {
      throw new Error("Expected outbox failure state");
    }
    expect(failureState.nextAttemptAt).to.equal(undefined);
    expect(failureState.exhaustedAt).to.be.instanceOf(Date);
    if (!(failureState.exhaustedAt instanceof Date)) {
      throw new Error("Expected an exhaustion timestamp");
    }
    expect(failureState.exhaustedAt.getTime()).to.equal(now);
    expect(metricsService.setOutboxBacklogStatus.secondCall.args[0]).to.equal(
      1,
    );
    expect(exhaustionLog.calledOnce).to.equal(true);
    expect(exhaustionLog.firstCall.args).to.deep.equal([
      "Outbox event exhausted automatic retries",
      {
        event: "worker.outbox.event_exhausted",
        eventId: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        retryCount: MAX_OUTBOX_RETRIES,
        ageMs: 90_000,
        replayGuidance:
          "Resolve the underlying failure, then run requeue-outbox-event with this event ID.",
      },
    ]);
  });

  it("markAsFailed throwing preserves both primary and secondary errors", async () => {
    const { eventBus, outboxRepository, outboxWorker, sandbox, arrangeClaims } =
      harness;
    let records: IOutboxEvent[];

    const primaryFailure = new Error("Handler failed");
    const markAsFailedFailure = new Error("markAsFailed failed");
    const terminalLogger = sandbox.stub(errorLogger, "error");
    const handleSpy = sandbox
      .stub<[unknown], Promise<void>>()
      .rejects(primaryFailure);
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
    arrangeClaims([records[0]]);
    outboxRepository.markAsFailed.rejects(markAsFailedFailure);

    outboxWorker.start();
    await outboxWorker.stop();

    sinon.assert.calledOnce(terminalLogger);
    const terminalRecord = terminalLogSchema.parse(
      terminalLogger.firstCall.args[0],
    );
    expect(terminalRecord.event).to.equal("worker.polling.tick.failed");
    if (!terminalRecord.error)
      throw new Error("Expected serialized aggregate error");
    expect(terminalRecord.error.name).to.equal("AggregateError");
    expect(
      terminalRecord.error.errors?.map(
        ({ message }: { message: string }) => message,
      ),
    ).to.deep.equal(["Handler failed", "markAsFailed failed"]);
    expect(terminalRecord.error.cause?.message).to.equal("Handler failed");
    expect(
      terminalRecord.breadcrumbs.map(({ event }: { event: string }) => event),
    ).to.deep.equal([
      "worker.outbox.received",
      "worker.outbox.handler.enter",
      "worker.outbox.handler.failed",
      "worker.outbox.retry.requested",
      "worker.polling.tick.failed",
    ]);
    expect(
      terminalRecord.breadcrumbs.every(
        ({ offsetMs }: { offsetMs?: number }) => typeof offsetMs === "number",
      ),
    ).to.equal(true);
  });
});
