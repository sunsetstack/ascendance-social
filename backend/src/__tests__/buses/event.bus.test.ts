import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { mongo } from "mongoose";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { OutboxModel } from "@/models/outbox.model";
import { sessionALS } from "@/database/UnitOfWork";
import { runWithRequestContext } from "@/runtime/request-context";
import {
  TestEvent,
  TestEventHandler,
  FirstTestEventHandler,
  SecondTestEventHandler,
} from "../helpers/outbox-fixtures";

describe("EventBus", () => {
  let sandbox: sinon.SinonSandbox;
  let outboxRepository: sinon.SinonStubbedInstance<OutboxRepository>;
  let metricsService: sinon.SinonStubbedInstance<MetricsService>;
  let eventBus: EventBus;
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    outboxRepository = sandbox.createStubInstance(OutboxRepository);
    metricsService = sandbox.createStubInstance(MetricsService);
    eventBus = new EventBus(outboxRepository, metricsService);
  });
  afterEach(() => sandbox.restore());

  describe("EventBus.queueTransactional", () => {
    it("should throw an error if called outside a transaction session", async () => {
      const event = new TestEvent("test");

      try {
        await eventBus.queueTransactional(event);
        expect.fail("Should have thrown an error");
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error;
        expect(error.message).to.equal(
          "queueTransactional must be called within a UnitOfWork transaction context",
        );
      }
      sinon.assert.notCalled(outboxRepository.saveEvent);
    });

    it("should save the event to the outbox repository when inside a transaction session", async () => {
      const event = new TestEvent("test");
      const mongoClient = new mongo.MongoClient("mongodb://127.0.0.1:27017");
      const mockSession = mongoClient.startSession();
      mockSession.startTransaction();
      outboxRepository.saveEvent.callsFake(
        async (eventType, payload, traceId, correlationId) => {
          expect(sessionALS.getStore()).to.equal(mockSession);
          expect(mockSession.inTransaction()).to.equal(true);
          return new OutboxModel({
            eventType,
            payload,
            traceId,
            correlationId,
          });
        },
      );

      try {
        await runWithRequestContext(
          { correlationId: "request-123" },
          async () =>
            sessionALS.run(mockSession, async () => {
              await eventBus.queueTransactional(event);
            }),
        );
      } finally {
        await mockSession.endSession();
        await mongoClient.close();
      }
      expect(sessionALS.getStore()).to.equal(undefined);
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

      const payload = new TestEvent("test data");
      await eventBus.publishByType("TestEvent", payload);

      expect(handleSpy.calledOnce).to.be.true;
      expect(handleSpy.firstCall.args[0]).to.deep.equal(payload);
    });
  });

  it("exposes handler keys and registration order without exposing the subscription array", async () => {
    const first = new FirstTestEventHandler();
    const second = new SecondTestEventHandler();
    const firstHandle = sandbox.stub(first, "handle").resolves();
    const secondHandle = sandbox.stub(second, "handle").resolves();
    eventBus.subscribe(TestEvent, first);
    eventBus.subscribe(TestEvent, second);
    const handlers = eventBus.getRegisteredHandlers("TestEvent");
    expect(handlers.map(({ key }) => key)).to.deep.equal([
      "FirstTestEventHandler",
      "SecondTestEventHandler",
    ]);
    const event = new TestEvent("registered");
    await handlers[0].handle(event);
    await handlers[1].handle(event);
    sinon.assert.calledOnceWithExactly(firstHandle, event);
    sinon.assert.calledOnceWithExactly(secondHandle, event);
    handlers.pop();
    expect(eventBus.getRegisteredHandlers("TestEvent")).to.have.lengthOf(2);
  });
});
