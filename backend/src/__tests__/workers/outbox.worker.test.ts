import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
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
  let outboxWorker: OutboxWorker;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Create stubs for the repository
    outboxRepository = {
      saveEvent: sandbox.stub(),
      getUnprocessedEvents: sandbox.stub(),
      markAsProcessed: sandbox.stub(),
      markAsFailed: sandbox.stub(),
    } as unknown as sinon.SinonStubbedInstance<OutboxRepository>;

    eventBus = new EventBus(outboxRepository as any);
    outboxWorker = new OutboxWorker(outboxRepository as any, eventBus);
  });

  afterEach(() => {
    outboxWorker.stop();
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

      // Wrap the call in ALS
      await sessionALS.run(mockSession, async () => {
        await eventBus.queueTransactional(event);
      });

      expect(outboxRepository.saveEvent.calledOnce).to.be.true;
      expect(outboxRepository.saveEvent.firstCall.args[0]).to.equal("TestEvent");
      expect(outboxRepository.saveEvent.firstCall.args[1]).to.equal(event);
      expect(outboxRepository.saveEvent.firstCall.args[2]).to.equal(mockSession);
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
      // Setup handler
      const handler = new TestEventHandler();
      const handleSpy = sandbox.stub(handler, "handle").resolves();
      eventBus.subscribe(TestEvent, handler);

      // Mock DB records
      const mockEvents = [
        { _id: "event1", eventType: "TestEvent", payload: { payload: "first" } },
        { _id: "event2", eventType: "TestEvent", payload: { payload: "second" } }
      ];
      outboxRepository.getUnprocessedEvents.resolves(mockEvents as any);
      outboxRepository.markAsProcessed.resolves();

      // Make processOutbox public for testing by calling it via any or casting
      await (outboxWorker as any).processOutbox();

      expect(outboxRepository.getUnprocessedEvents.calledOnce).to.be.true;
      expect(handleSpy.calledTwice).to.be.true;
      expect(handleSpy.firstCall.args[0]).to.deep.equal({ payload: "first" });
      expect(handleSpy.secondCall.args[0]).to.deep.equal({ payload: "second" });
      
      expect(outboxRepository.markAsProcessed.calledTwice).to.be.true;
      expect(outboxRepository.markAsProcessed.firstCall.args[0]).to.equal("event1");
      expect(outboxRepository.markAsProcessed.secondCall.args[0]).to.equal("event2");
      expect(outboxRepository.markAsFailed.called).to.be.false;
    });

    it("should mark event as failed if handler throws an error", async () => {
      // Setup handler that throws
      const handler = new TestEventHandler();
      const handleSpy = sandbox.stub(handler, "handle").rejects(new Error("Handler failed"));
      eventBus.subscribe(TestEvent, handler);

      // Mock DB records
      const mockEvents = [
        { _id: "event1", eventType: "TestEvent", payload: { payload: "first" } }
      ];
      outboxRepository.getUnprocessedEvents.resolves(mockEvents as any);
      outboxRepository.markAsFailed.resolves();

      await (outboxWorker as any).processOutbox();

      expect(handleSpy.calledOnce).to.be.true;
      expect(outboxRepository.markAsProcessed.called).to.be.false;
      expect(outboxRepository.markAsFailed.calledOnce).to.be.true;
      expect(outboxRepository.markAsFailed.firstCall.args[0]).to.equal("event1");
      expect(outboxRepository.markAsFailed.firstCall.args[1]).to.equal("Handler failed");
    });
  });
});
