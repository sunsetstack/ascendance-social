import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { errorLogger } from "@/utils/winston";
import { OutboxWorker } from "@/workers/outbox.worker";
import { createDeferred, createRecord, TestEvent } from "../helpers/outbox-fixtures";

describe("OutboxWorker scheduled draining", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let repository: sinon.SinonStubbedInstance<OutboxRepository>;
  let eventBus: sinon.SinonStubbedInstance<EventBus>;
  let worker: OutboxWorker;
  let queue: ReturnType<typeof createRecord>[];
  let processed: string[];
  let delivered: string[];
  let terminalError: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers({ now: Date.parse("2026-10-18T00:00:00Z") });
    terminalError = sandbox.stub(errorLogger, "error");
    repository = sandbox.createStubInstance(OutboxRepository);
    eventBus = sandbox.createStubInstance(EventBus);
    const metrics = sandbox.createStubInstance(MetricsService);
    queue = Array.from({ length: 51 }, (_, index) => createRecord({
      _id: (index + 1).toString(16).padStart(24, "0"), payload: new TestEvent(`event-${index}`),
    }));
    processed = []; delivered = [];
    repository.getBacklogStats.callsFake(async () => ({ pendingCount: queue.length, exhaustedCount: 0 }));
    repository.claimPendingEvents.callsFake(async () => {
      const record = queue.shift();
      return record ? [record] : [];
    });
    repository.renewClaim.resolves(true);
    repository.markHandlerProcessed.resolves(true);
    repository.markAsProcessed.callsFake(async id => { processed.push(id); return true; });
    eventBus.getRegisteredHandlers.returns([{ key: "TestEventHandler", handle: async event => {
      delivered.push((event as TestEvent).payload);
    } }]);
    worker = new OutboxWorker(repository, eventBus, metrics);
  });

  afterEach(async () => {
    try { await worker.stop(); }
    finally { sandbox.restore(); }
  });

  it("delivers the next bounded batch without the idle polling delay", async () => {
    const expectedIds = queue.map(record => String(record._id));
    worker.start();
    await clock.tickAsync(1);
    expect(processed).to.deep.equal(expectedIds);
    expect(delivered).to.deep.equal(Array.from({ length: 51 }, (_, index) => `event-${index}`));
    sinon.assert.callCount(repository.markHandlerProcessed, 51);
    sinon.assert.notCalled(repository.markAsFailed);
    const polls = repository.getBacklogStats.callCount;
    await clock.tickAsync(1000);
    expect(repository.getBacklogStats.callCount).to.equal(polls);
    await clock.tickAsync(1000);
    expect(repository.getBacklogStats.callCount).to.equal(polls + 1);
  });

  it("returns to the idle interval when remaining records cannot be claimed", async () => {
    queue.pop();
    repository.getBacklogStats.callsFake(async () => ({ pendingCount: queue.length + 1, exhaustedCount: 0 }));
    worker.start();
    await clock.tickAsync(1);
    expect(processed).to.have.length(50);
    sinon.assert.callCount(repository.claimPendingEvents, 51);
    await clock.tickAsync(1000);
    sinon.assert.callCount(repository.claimPendingEvents, 51);
    await clock.tickAsync(1000);
    sinon.assert.callCount(repository.claimPendingEvents, 52);
  });

  it("backs off after a poll error following a full batch", async () => {
    repository.getBacklogStats.onCall(2).rejects(new Error("database unavailable"));
    worker.start();
    await clock.tickAsync(1);
    expect(processed).to.have.length(50);
    sinon.assert.calledOnce(terminalError);
    await clock.tickAsync(1000);
    expect(processed).to.have.length(50);
    await clock.tickAsync(1000);
    expect(processed).to.have.length(51);
  });

  it("awaits the current handler on shutdown and leaves the next batch unclaimed", async () => {
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    eventBus.getRegisteredHandlers.returns([{ key: "TestEventHandler", handle: async event => {
      delivered.push((event as TestEvent).payload);
      if ((event as TestEvent).payload === "event-49") {
        entered.resolve();
        await release.promise;
      }
    } }]);
    worker.start();
    try {
      await clock.tickAsync(0);
      await entered.promise;
      const stopping = worker.stop();
      await clock.tickAsync(1000);
      expect(processed).to.have.length(49);
      release.resolve();
      await stopping;
      await clock.tickAsync(10_000);
      expect(processed).to.have.length(50);
      expect(delivered).to.have.length(50);
      expect(queue).to.have.length(1);
      sinon.assert.callCount(repository.claimPendingEvents, 50);
    } finally { release.resolve(); }
  });
});
