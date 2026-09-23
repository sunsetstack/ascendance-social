import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import {
  MAX_OUTBOX_RETRIES,
  OutboxRepository,
} from "@/repositories/outbox.repository";
import { OutboxWorker } from "@/workers/outbox.worker";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { sessionALS } from "@/database/UnitOfWork";
import { ClientSession } from "mongoose";
import {
  getRequestContext,
  runWithRequestContext,
} from "@/runtime/request-context";
import { errorLogger, logger } from "@/utils/winston";

class TestEvent implements IEvent {
  readonly type = "TestEvent";
  readonly timestamp = new Date();

  constructor(public payload: string) {}
}

class TestEventHandler implements IEventHandler<TestEvent> {
  async handle(event: TestEvent): Promise<void> {
    // mock handle
  }
}

class FirstTestEventHandler implements IEventHandler<TestEvent> {
  async handle(event: TestEvent): Promise<void> {
    void event;
  }
}

class SecondTestEventHandler implements IEventHandler<TestEvent> {
  async handle(event: TestEvent): Promise<void> {
    void event;
  }
}

describe("Transactional Outbox Pattern", () => {
  let eventBus: EventBus;
  let outboxRepository: sinon.SinonStubbedInstance<OutboxRepository>;
  let metricsService: sinon.SinonStubbedInstance<MetricsService>;
  let outboxWorker: OutboxWorker;
  let sandbox: sinon.SinonSandbox;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    outboxRepository = {
      saveEvent: sandbox.stub(),
      countPendingEvents: sandbox.stub().resolves(0),
      claimPendingEvents: sandbox.stub().resolves([]),
      getUnprocessedEvents: sandbox.stub(),
      markHandlerProcessed: sandbox.stub(),
      markAsProcessed: sandbox.stub(),
      markAsFailed: sandbox.stub(),
    } as unknown as sinon.SinonStubbedInstance<OutboxRepository>;

    metricsService = sinon.createStubInstance(MetricsService);
    eventBus = new EventBus(outboxRepository as any, metricsService as any);
    outboxWorker = new OutboxWorker(
      outboxRepository as any,
      eventBus,
      metricsService as any,
    );
  });

  afterEach(async () => {
    await outboxWorker.stop();
    sandbox.restore();
  });

  describe("EventBus.queueTransactional", () => {
    it("should throw an error if called outside a transaction session", async () => {
      const event = new TestEvent("test");

      try {
        await eventBus.queueTransactional(event);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.equal(
          "queueTransactional must be called within a UnitOfWork transaction context",
        );
      }
    });

    it("should save the event to the outbox repository when inside a transaction session", async () => {
      const event = new TestEvent("test");
      const mockSession = {
        inTransaction: sinon.stub().returns(true),
      } as unknown as ClientSession;

      await runWithRequestContext({ correlationId: "request-123" }, async () =>
        sessionALS.run(mockSession, async () => {
          await eventBus.queueTransactional(event);
        }),
      );

      expect(outboxRepository.saveEvent.calledOnce).to.be.true;
      expect(outboxRepository.saveEvent.firstCall.args[0]).to.equal(
        "TestEvent",
      );
      expect(outboxRepository.saveEvent.firstCall.args[1]).to.equal(event);
      expect(outboxRepository.saveEvent.firstCall.args).to.have.lengthOf(4);
      expect(String(outboxRepository.saveEvent.firstCall.args[2])).to.match(
        uuidPattern,
      );
      expect(outboxRepository.saveEvent.firstCall.args[3]).to.equal(
        "request-123",
      );
    });
  });

  describe("EventBus.publishByType", () => {
    it("should call the correct registered handlers based on eventType string", async () => {
      const handler = new TestEventHandler();
      const handleSpy = sandbox.stub(handler, "handle").resolves();

      eventBus.subscribe(TestEvent, handler);

      const payload = { payload: "test data" };
      await eventBus.publishByType("TestEvent", payload);

      expect(handleSpy.calledOnce).to.be.true;
      expect(handleSpy.firstCall.args[0]).to.deep.equal(payload);
    });
  });

  describe("OutboxWorker.processOutbox", () => {
    it("adds retry jitter within a bounded twenty-percent window", () => {
      const originalBaseDelay = process.env.OUTBOX_RETRY_BASE_DELAY_MS;
      const originalMaxDelay = process.env.OUTBOX_RETRY_MAX_DELAY_MS;
      process.env.OUTBOX_RETRY_BASE_DELAY_MS = "5000";
      process.env.OUTBOX_RETRY_MAX_DELAY_MS = "10000";
      const random = sandbox.stub(Math, "random");
      random.onFirstCall().returns(0);
      random.onSecondCall().returns(1);

      try {
        expect((outboxWorker as any).retryDelayMs(1)).to.equal(4000);
        expect((outboxWorker as any).retryDelayMs(1)).to.equal(6000);
      } finally {
        restoreEnv("OUTBOX_RETRY_BASE_DELAY_MS", originalBaseDelay);
        restoreEnv("OUTBOX_RETRY_MAX_DELAY_MS", originalMaxDelay);
      }
    });

    it("should process unprocessed events and mark them as processed", async () => {
      const handler = new TestEventHandler();
      const infoLogger = sandbox.stub(logger, "info");
      const handleSpy = sandbox.stub(handler, "handle").resolves();
      eventBus.subscribe(TestEvent, handler);

      const mockEvents = [
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 0,
          traceId: "trace-1",
          processedHandlers: [],
        },
        {
          _id: "event2",
          eventType: "TestEvent",
          payload: { payload: "second" },
          retries: 0,
          traceId: "trace-2",
          processedHandlers: [],
        },
      ];
      outboxRepository.countPendingEvents.onFirstCall().resolves(2);
      outboxRepository.countPendingEvents.onSecondCall().resolves(0);
      outboxRepository.claimPendingEvents.resolves(mockEvents as any);
      outboxRepository.markHandlerProcessed.resolves(true);
      outboxRepository.markAsProcessed.resolves(true);

      await (outboxWorker as any).tick();

      expect(metricsService.setOutboxPendingCount.firstCall.args[0]).to.equal(
        2,
      );
      expect(metricsService.recordOutboxBatchSize.calledOnceWithExactly(2)).to
        .be.true;
      expect(outboxRepository.claimPendingEvents.calledOnce).to.be.true;
      expect(handleSpy.calledTwice).to.be.true;
      expect(handleSpy.firstCall.args[0]).to.deep.equal({ payload: "first" });
      expect(handleSpy.secondCall.args[0]).to.deep.equal({ payload: "second" });

      expect(outboxRepository.markHandlerProcessed.calledTwice).to.be.true;
      expect(
        outboxRepository.markHandlerProcessed.firstCall.calledWith(
          "event1",
          "TestEventHandler",
          sinon.match.string,
        ),
      ).to.be.true;
      expect(
        outboxRepository.markHandlerProcessed.secondCall.calledWith(
          "event2",
          "TestEventHandler",
          sinon.match.string,
        ),
      ).to.be.true;
      expect(outboxRepository.markAsProcessed.calledTwice).to.be.true;
      expect(outboxRepository.markAsProcessed.firstCall.args[0]).to.equal(
        "event1",
      );
      expect(outboxRepository.markAsProcessed.firstCall.args[1]).to.be.a(
        "string",
      );
      expect(outboxRepository.markAsProcessed.secondCall.args[0]).to.equal(
        "event2",
      );
      expect(outboxRepository.markAsProcessed.secondCall.args[1]).to.be.a(
        "string",
      );
      expect(outboxRepository.markAsFailed.called).to.be.false;
      expect(metricsService.recordOutboxAttempt.calledTwice).to.be.true;
      expect(metricsService.recordOutboxAttempt.firstCall.args[0]).to.equal(
        "TestEvent",
      );
      expect(metricsService.recordOutboxAttempt.firstCall.args[1]).to.equal(
        "processed",
      );
      expect(metricsService.setOutboxPendingCount.secondCall.args[0]).to.equal(
        0,
      );
      const [, terminalRecord] = infoLogger.lastCall.args as unknown as [
        string,
        {
          event: string;
        },
      ];
      expect(terminalRecord.event).to.equal("outbox.event.processed");
      expect(terminalRecord).not.to.have.property("breadcrumbs");
    });

    it("should mark event as failed if handler throws an error", async () => {
      const handler = new TestEventHandler();
      const terminalLogger = sandbox.stub(errorLogger, "error");
      const failureTime = Date.parse("2026-07-30T12:00:00.000Z");
      sandbox.stub(Date, "now").returns(failureTime);
      sandbox.stub(Math, "random").returns(0.5);
      let breadcrumbsAtMark: string[] | undefined;
      const handleSpy = sandbox
        .stub(handler, "handle")
        .rejects(new Error("Handler failed"));
      eventBus.subscribe(TestEvent, handler);

      const mockEvents = [
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 2,
          traceId: "trace-1",
          processedHandlers: [],
        },
      ];
      outboxRepository.countPendingEvents.onFirstCall().resolves(1);
      outboxRepository.countPendingEvents.onSecondCall().resolves(1);
      outboxRepository.claimPendingEvents.resolves(mockEvents as any);
      outboxRepository.markAsFailed.callsFake(async () => {
        breadcrumbsAtMark = getRequestContext()?.breadcrumbs.map(
          ({ event }) => event,
        );
        return true;
      });

      await (outboxWorker as any).tick();

      expect(handleSpy.calledOnce).to.be.true;
      expect(outboxRepository.markAsProcessed.called).to.be.false;
      expect(outboxRepository.markHandlerProcessed.called).to.be.false;
      expect(outboxRepository.markAsFailed.calledOnce).to.be.true;
      expect(outboxRepository.markAsFailed.firstCall.args[0]).to.equal(
        "event1",
      );
      expect(outboxRepository.markAsFailed.firstCall.args[1]).to.equal(
        "Handler failed",
      );
      expect(outboxRepository.markAsFailed.firstCall.args[2]).to.be.a("string");
      expect(
        outboxRepository.markAsFailed.firstCall.args[3],
      ).to.deep.equal({
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
      const [terminalRecord] = terminalLogger.firstCall.args as unknown as [
        {
          breadcrumbs: Array<{ event: string; offsetMs?: number }>;
        },
      ];
      expect(
        terminalRecord.breadcrumbs.map(({ event }) => event),
      ).to.deep.equal([
        "worker.outbox.received",
        "worker.outbox.handler.enter",
        "worker.outbox.handler.failed",
        "worker.outbox.retry.requested",
        "worker.outbox.retry.scheduled",
      ]);
      expect(
        terminalRecord.breadcrumbs.every(
          ({ offsetMs }) => typeof offsetMs === "number",
        ),
      ).to.equal(true);
      expect(terminalRecord).to.have.property("message", "Outbox event failed");
      sandbox.assert.callOrder(
        metricsService.recordOutboxAttempt as any,
        outboxRepository.markAsFailed as any,
      );
    });

    it("marks exhausted events, updates the metric, and emits replay guidance", async () => {
      const now = Date.parse("2026-07-30T12:00:00.000Z");
      const createdAt = new Date(now - 90_000);
      sandbox.stub(Date, "now").returns(now);
      sandbox.stub(Math, "random").returns(0.5);
      const handler = new TestEventHandler();
      sandbox
        .stub(handler, "handle")
        .rejects(new Error("terminal handler failure"));
      eventBus.subscribe(TestEvent, handler);
      const exhaustionLog = sandbox.stub(logger, "error");
      sandbox.stub(errorLogger, "error");
      (outboxRepository as any).getBacklogStats = sandbox
        .stub()
        .onFirstCall()
        .resolves({
          pendingCount: 1,
          exhaustedCount: 0,
          oldestPendingAt: createdAt,
        })
        .onSecondCall()
        .resolves({
          pendingCount: 0,
          exhaustedCount: 1,
        });
      outboxRepository.claimPendingEvents.resolves([
        {
          _id: "event1",
          createdAt,
          eventType: "TestEvent",
          payload: { payload: "first" },
          processedHandlers: [],
          retries: MAX_OUTBOX_RETRIES - 1,
          traceId: "trace-1",
        },
      ] as any);
      outboxRepository.markAsFailed.resolves(true);

      await (outboxWorker as any).tick();

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
      expect(
        metricsService.setOutboxBacklogStatus.secondCall.args[0],
      ).to.equal(1);
      expect(exhaustionLog.calledOnce).to.equal(true);
      expect(exhaustionLog.firstCall.args).to.deep.equal([
        "Outbox event exhausted automatic retries",
        {
          event: "worker.outbox.event_exhausted",
          eventId: "event1",
          eventType: "TestEvent",
          retryCount: MAX_OUTBOX_RETRIES,
          ageMs: 90_000,
          replayGuidance:
            "Resolve the underlying failure, then run requeue-outbox-event with this event ID.",
        },
      ]);
    });

    it("records processing.failed for checkpoint ownership failures", async () => {
      const handler = new TestEventHandler();
      const terminalLogger = sandbox.stub(errorLogger, "error");
      sandbox.stub(handler, "handle").resolves();
      eventBus.subscribe(TestEvent, handler);

      outboxRepository.countPendingEvents.onFirstCall().resolves(1);
      outboxRepository.countPendingEvents.onSecondCall().resolves(1);
      outboxRepository.claimPendingEvents.resolves([
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 0,
          traceId: "trace-1",
          processedHandlers: [],
        },
      ] as any);
      outboxRepository.markHandlerProcessed.resolves(false);
      outboxRepository.markAsFailed.resolves(true);

      await (outboxWorker as any).tick();

      const [terminalRecord] = terminalLogger.firstCall.args as unknown as [
        { breadcrumbs: Array<{ event: string }> },
      ];
      expect(terminalRecord.breadcrumbs.map(({ event }) => event)).to.include(
        "worker.outbox.processing.failed",
      );
      expect(
        terminalRecord.breadcrumbs.map(({ event }) => event),
      ).not.to.include("worker.outbox.handler.failed");
    });

    it("does not schedule a retry after ownership changes", async () => {
      const handler = new TestEventHandler();
      const terminalLogger = sandbox.stub(errorLogger, "error");
      const warningLogger = sandbox.stub(logger, "warn");
      sandbox.stub(handler, "handle").rejects(new Error("Handler failed"));
      eventBus.subscribe(TestEvent, handler);

      outboxRepository.countPendingEvents.onFirstCall().resolves(1);
      outboxRepository.countPendingEvents.onSecondCall().resolves(1);
      outboxRepository.claimPendingEvents.resolves([
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 0,
          traceId: "trace-1",
          processedHandlers: [],
        },
      ] as any);
      outboxRepository.markAsFailed.resolves(false);

      await (outboxWorker as any).tick();

      const [terminalRecord] = terminalLogger.firstCall.args as unknown as [
        { breadcrumbs: Array<{ event: string }> },
      ];
      const warningRecord = (
        warningLogger.firstCall.args as unknown as [string, { event: string }]
      )[1];
      expect(
        terminalRecord.breadcrumbs.map(({ event }) => event),
      ).not.to.include("worker.outbox.retry.scheduled");
      expect(warningRecord).to.deep.include({
        event: "outbox.event.ownership_lost",
      });
    });

    it("markAsFailed throwing preserves both primary and secondary errors", async () => {
      const handler = new TestEventHandler();
      const primaryFailure = new Error("Handler failed");
      const markAsFailedFailure = new Error("markAsFailed failed");
      const terminalLogger = sandbox.stub(errorLogger, "error");
      sandbox.stub(handler, "handle").rejects(primaryFailure);
      eventBus.subscribe(TestEvent, handler);

      outboxRepository.countPendingEvents.resolves(1);
      outboxRepository.claimPendingEvents.resolves([
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 0,
          traceId: "trace-1",
          processedHandlers: [],
        },
      ] as any);
      outboxRepository.markAsFailed.rejects(markAsFailedFailure);

      await (outboxWorker as any).executeTick();

      sinon.assert.calledOnce(terminalLogger);
      const [terminalRecord] = terminalLogger.firstCall.args as unknown as [
        {
          event: string;
          error: {
            name: string;
            message: string;
            errors?: Array<{ message: string }>;
            cause?: { message: string };
          };
          breadcrumbs: Array<{ event: string; offsetMs?: number }>;
        },
      ];
      expect(terminalRecord.event).to.equal("worker.polling.tick.failed");
      expect(terminalRecord.error.name).to.equal("AggregateError");
      expect(terminalRecord.error.errors?.map(({ message }) => message)).to.deep.equal([
        "Handler failed",
        "markAsFailed failed",
      ]);
      expect(terminalRecord.error.cause?.message).to.equal("Handler failed");
      expect(
        terminalRecord.breadcrumbs.map(({ event }) => event),
      ).to.deep.equal([
        "worker.outbox.received",
        "worker.outbox.handler.enter",
        "worker.outbox.handler.failed",
        "worker.outbox.retry.requested",
        "worker.polling.tick.failed",
      ]);
      expect(terminalRecord.breadcrumbs.every(({ offsetMs }) => typeof offsetMs === "number")).to.equal(true);
    });

    it("should continue processing later events when an earlier event fails", async () => {
      const handler = new TestEventHandler();
      const handleSpy = sandbox
        .stub(handler, "handle")
        .callsFake(async (event) => {
          if (event.payload === "first") {
            throw new Error("first failed");
          }
        });
      eventBus.subscribe(TestEvent, handler);

      const mockEvents = [
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 0,
          traceId: "trace-1",
          processedHandlers: [],
        },
        {
          _id: "event2",
          eventType: "TestEvent",
          payload: { payload: "second" },
          retries: 0,
          traceId: "trace-2",
          processedHandlers: [],
        },
      ];
      outboxRepository.countPendingEvents.onFirstCall().resolves(2);
      outboxRepository.countPendingEvents.onSecondCall().resolves(1);
      outboxRepository.claimPendingEvents.resolves(mockEvents as any);
      outboxRepository.markHandlerProcessed.resolves(true);
      outboxRepository.markAsFailed.resolves(true);
      outboxRepository.markAsProcessed.resolves(true);

      await (outboxWorker as any).tick();

      expect(handleSpy.calledTwice).to.be.true;
      expect(
        outboxRepository.markAsFailed.calledOnceWith("event1", "first failed"),
      ).to.be.true;
      expect(outboxRepository.markAsProcessed.calledOnceWith("event2")).to.be
        .true;
    });

    it("should resume from the first unprocessed handler on retry", async () => {
      const firstHandler = new FirstTestEventHandler();
      const secondHandler = new SecondTestEventHandler();
      const firstHandleSpy = sandbox.stub(firstHandler, "handle").resolves();
      const secondHandleSpy = sandbox.stub(secondHandler, "handle").resolves();
      eventBus.subscribe(TestEvent, firstHandler);
      eventBus.subscribe(TestEvent, secondHandler);

      const mockEvents = [
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "resume" },
          retries: 1,
          traceId: "trace-1",
          processedHandlers: ["FirstTestEventHandler"],
        },
      ];

      outboxRepository.countPendingEvents.onFirstCall().resolves(1);
      outboxRepository.countPendingEvents.onSecondCall().resolves(0);
      outboxRepository.claimPendingEvents.resolves(mockEvents as any);
      outboxRepository.markHandlerProcessed.resolves(true);
      outboxRepository.markAsProcessed.resolves(true);

      await (outboxWorker as any).tick();

      expect(firstHandleSpy.called).to.be.false;
      expect(secondHandleSpy.calledOnce).to.be.true;
      expect(secondHandleSpy.firstCall.args[0]).to.deep.equal({
        payload: "resume",
      });
      expect(
        outboxRepository.markHandlerProcessed.calledOnceWithExactly(
          "event1",
          "SecondTestEventHandler",
          sinon.match.string,
        ),
      ).to.be.true;
      expect(outboxRepository.markAsProcessed.calledOnceWith("event1")).to.be
        .true;
    });
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
