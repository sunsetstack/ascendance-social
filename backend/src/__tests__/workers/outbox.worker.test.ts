import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { OutboxWorker } from "@/workers/outbox.worker";
import { IEvent } from "@/application/common/interfaces/event.interface";
import { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import { sessionALS } from "@/database/UnitOfWork";
import { ClientSession } from "mongoose";

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
      getUnprocessedEvents: sandbox.stub(),
      markAsProcessed: sandbox.stub(),
      markAsFailed: sandbox.stub(),
    } as unknown as sinon.SinonStubbedInstance<OutboxRepository>;

    metricsService = sinon.createStubInstance(MetricsService);
    eventBus = new EventBus(outboxRepository as any);
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
        expect(error.message).to.equal("queueTransactional must be called within a UnitOfWork transaction context");
      }
    });

    it("should save the event to the outbox repository when inside a transaction session", async () => {
      const event = new TestEvent("test");
      const mockSession = {} as ClientSession;

      await sessionALS.run(mockSession, async () => {
        await eventBus.queueTransactional(event);
      });

      expect(outboxRepository.saveEvent.calledOnce).to.be.true;
      expect(outboxRepository.saveEvent.firstCall.args[0]).to.equal("TestEvent");
      expect(outboxRepository.saveEvent.firstCall.args[1]).to.equal(event);
      expect(outboxRepository.saveEvent.firstCall.args).to.have.lengthOf(3);
      expect(String(outboxRepository.saveEvent.firstCall.args[2])).to.match(
        uuidPattern,
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
    it("should process unprocessed events and mark them as processed", async () => {
      const handler = new TestEventHandler();
      const handleSpy = sandbox.stub(handler, "handle").resolves();
      eventBus.subscribe(TestEvent, handler);

      const mockEvents = [
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 0,
          traceId: "trace-1",
        },
        {
          _id: "event2",
          eventType: "TestEvent",
          payload: { payload: "second" },
          retries: 0,
          traceId: "trace-2",
        },
      ];
      outboxRepository.countPendingEvents.onFirstCall().resolves(2);
      outboxRepository.countPendingEvents.onSecondCall().resolves(0);
      outboxRepository.getUnprocessedEvents.resolves(mockEvents as any);
      outboxRepository.markAsProcessed.resolves();

      await (outboxWorker as any).tick();

      expect(metricsService.setOutboxPendingCount.firstCall.args[0]).to.equal(2);
      expect(metricsService.recordOutboxBatchSize.calledOnceWithExactly(2)).to.be
        .true;
      expect(outboxRepository.getUnprocessedEvents.calledOnce).to.be.true;
      expect(handleSpy.calledTwice).to.be.true;
      expect(handleSpy.firstCall.args[0]).to.deep.equal({ payload: "first" });
      expect(handleSpy.secondCall.args[0]).to.deep.equal({ payload: "second" });

      expect(outboxRepository.markAsProcessed.calledTwice).to.be.true;
      expect(outboxRepository.markAsProcessed.firstCall.args[0]).to.equal("event1");
      expect(outboxRepository.markAsProcessed.secondCall.args[0]).to.equal("event2");
      expect(outboxRepository.markAsFailed.called).to.be.false;
      expect(metricsService.recordOutboxAttempt.calledTwice).to.be.true;
      expect(metricsService.recordOutboxAttempt.firstCall.args[0]).to.equal(
        "TestEvent",
      );
      expect(metricsService.recordOutboxAttempt.firstCall.args[1]).to.equal(
        "processed",
      );
      expect(metricsService.setOutboxPendingCount.secondCall.args[0]).to.equal(0);
    });

    it("should mark event as failed if handler throws an error", async () => {
      const handler = new TestEventHandler();
      const handleSpy = sandbox.stub(handler, "handle").rejects(new Error("Handler failed"));
      eventBus.subscribe(TestEvent, handler);

      const mockEvents = [
        {
          _id: "event1",
          eventType: "TestEvent",
          payload: { payload: "first" },
          retries: 2,
          traceId: "trace-1",
        },
      ];
      outboxRepository.countPendingEvents.onFirstCall().resolves(1);
      outboxRepository.countPendingEvents.onSecondCall().resolves(1);
      outboxRepository.getUnprocessedEvents.resolves(mockEvents as any);
      outboxRepository.markAsFailed.resolves();

      await (outboxWorker as any).tick();

      expect(handleSpy.calledOnce).to.be.true;
      expect(outboxRepository.markAsProcessed.called).to.be.false;
      expect(outboxRepository.markAsFailed.calledOnce).to.be.true;
      expect(outboxRepository.markAsFailed.firstCall.args[0]).to.equal("event1");
      expect(outboxRepository.markAsFailed.firstCall.args[1]).to.equal("Handler failed");
      expect(metricsService.recordOutboxAttempt.calledOnce).to.be.true;
      expect(metricsService.recordOutboxAttempt.firstCall.args[1]).to.equal(
        "failed",
      );
      sandbox.assert.callOrder(
        metricsService.recordOutboxAttempt as any,
        outboxRepository.markAsFailed as any,
      );
    });

    it("should continue processing later events when an earlier event fails", async () => {
      const handler = new TestEventHandler();
      const handleSpy = sandbox.stub(handler, "handle").callsFake(async (event) => {
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
        },
        {
          _id: "event2",
          eventType: "TestEvent",
          payload: { payload: "second" },
          retries: 0,
          traceId: "trace-2",
        },
      ];
      outboxRepository.countPendingEvents.onFirstCall().resolves(2);
      outboxRepository.countPendingEvents.onSecondCall().resolves(1);
      outboxRepository.getUnprocessedEvents.resolves(mockEvents as any);
      outboxRepository.markAsFailed.resolves();
      outboxRepository.markAsProcessed.resolves();

      await (outboxWorker as any).tick();

      expect(handleSpy.calledTwice).to.be.true;
      expect(outboxRepository.markAsFailed.calledOnceWithExactly("event1", "first failed")).to.be.true;
      expect(outboxRepository.markAsProcessed.calledOnceWithExactly("event2")).to.be.true;
    });
  });
});
