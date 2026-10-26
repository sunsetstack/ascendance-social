import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import type { IOutboxEvent } from "@/models/outbox.model";
import { errorLogger, logger } from "@/utils/winston";
import {
  TestEvent,
  createRecord,
  createDeferred,
  nextRecord,
} from "../helpers/outbox-fixtures";
import {
  createOutboxWorkerHarness,
  type OutboxWorkerHarness,
} from "../helpers/outbox-worker-harness";

describe("OutboxWorker lease renewal", () => {
  let harness: OutboxWorkerHarness;
  beforeEach(() => {
    harness = createOutboxWorkerHarness();
  });
  afterEach(async () => harness.cleanup());

  for (const renewal of ["retained", "lost", "unavailable"] as const) {
    it(`continues the tick after lease renewal is ${renewal} during a long handler`, async () => {
      const {
        eventBus,
        outboxRepository,
        outboxWorker,
        sandbox,
        arrangeClaims,
        assertClaims,
      } = harness;
      let records: IOutboxEvent[];

      process.env.OUTBOX_CLAIM_TIMEOUT_MS = "1000";
      sandbox.stub(errorLogger, "error");
      sandbox.stub(logger, "warn");
      const firstRecord = createRecord({
        _id: "507f1f77bcf86cd799439011",
        eventType: "TestEvent",
        payload: new TestEvent("first"),
        retries: 0,
        traceId: "trace-1",
        processedHandlers: [],
      });
      records = [firstRecord, nextRecord()];
      arrangeClaims([records[0]], [records[1]], []);
      let finishHandler: (() => void) | undefined;
      const heldHandler = new Promise<void>((resolve) => {
        finishHandler = resolve;
      });
      let enteredHandler: (() => void) | undefined;
      const handlerEntered = new Promise<void>((resolve) => {
        enteredHandler = resolve;
      });
      const handleSpy = sandbox
        .stub<[unknown], Promise<void>>()
        .callsFake(async (event) => {
          if (!(event instanceof TestEvent))
            throw new Error("Expected a TestEvent payload");
          if (event.payload === "first") {
            enteredHandler?.();
            await heldHandler;
          }
        });
      const laterHandleSpy = sandbox
        .stub<[unknown], Promise<void>>()
        .resolves();
      eventBus.getRegisteredHandlers.returns([
        { key: "TestEventHandler", handle: handleSpy },
        { key: "SecondTestEventHandler", handle: laterHandleSpy },
      ]);
      if (renewal === "lost") {
        outboxRepository.renewClaim.resolves(false);
        outboxRepository.markAsFailed.resolves(false);
      } else if (renewal === "unavailable") {
        outboxRepository.renewClaim.rejects(
          new Error("Database renewal unavailable"),
        );
      }

      const tick = outboxWorker.runTick();
      await handlerEntered;
      await sandbox.clock.tickAsync(333);
      const workerId = outboxRepository.claimPendingEvents.firstCall.args[1];
      sinon.assert.calledOnceWithExactly(
        outboxRepository.renewClaim,
        String(firstRecord._id),
        workerId,
      );
      sinon.assert.notCalled(outboxRepository.markHandlerProcessed);
      sinon.assert.notCalled(outboxRepository.markAsProcessed);
      if (!finishHandler) throw new Error("Expected a held handler");
      finishHandler();
      await tick;

      assertClaims(3);
      expect(handleSpy.getCalls().map(({ args }) => args)).to.deep.equal([
        [new TestEvent("first")],
        [new TestEvent("second")],
      ]);
      expect(sandbox.clock.countTimers()).to.equal(0);
      if (renewal === "retained") {
        expect(laterHandleSpy.getCalls().map(({ args }) => args)).to.deep.equal(
          [[new TestEvent("first")], [new TestEvent("second")]],
        );
        expect(
          outboxRepository.markAsProcessed.getCalls().map(({ args }) => args),
        ).to.deep.equal([
          [String(firstRecord._id), workerId],
          [String(records[1]._id), workerId],
        ]);
        sinon.assert.notCalled(outboxRepository.markAsFailed);
      } else {
        expect(firstRecord.processedHandlers).to.deep.equal([]);
        sinon.assert.calledOnceWithExactly(
          laterHandleSpy,
          new TestEvent("second"),
        );
        expect(
          outboxRepository.markHandlerProcessed
            .getCalls()
            .map(({ args }) => args),
        ).to.deep.equal([
          [String(records[1]._id), "TestEventHandler", workerId],
          [String(records[1]._id), "SecondTestEventHandler", workerId],
        ]);
        sinon.assert.calledOnceWithExactly(
          outboxRepository.markAsProcessed,
          String(records[1]._id),
          workerId,
        );
        sinon.assert.calledOnceWithExactly(
          outboxRepository.markAsFailed,
          String(firstRecord._id),
          renewal === "lost"
            ? "Outbox event ownership lost during processing"
            : "Database renewal unavailable",
          workerId,
          {
            nextAttemptAt: new Date(Date.now() + 15_000),
            exhaustedAt: undefined,
          },
        );
      }
    });
  }

  it("keeps renewing throughout a handler beyond the lease timeout and cleans up", async () => {
    const {
      eventBus,
      outboxRepository,
      outboxWorker,
      sandbox,
      arrangeClaims,
      assertClaims,
    } = harness;

    process.env.OUTBOX_CLAIM_TIMEOUT_MS = "1000";
    const record = createRecord({
      _id: "507f1f77bcf86cd799439011",
      payload: new TestEvent("held"),
    });
    arrangeClaims([record], []);
    const held = createDeferred<void>();
    const entered = createDeferred<void>();
    const handle = sandbox
      .stub<[unknown], Promise<void>>()
      .callsFake(async () => {
        entered.resolve();
        await held.promise;
      });
    eventBus.getRegisteredHandlers.returns([{ key: "held-handler", handle }]);
    const tick = outboxWorker.runTick();
    try {
      await entered.promise;
      await sandbox.clock.tickAsync(1001);
      const owner = outboxRepository.claimPendingEvents.firstCall.args[1];
      expect(
        outboxRepository.renewClaim.getCalls().map(({ args }) => args),
      ).to.deep.equal([
        [String(record._id), owner],
        [String(record._id), owner],
        [String(record._id), owner],
      ]);
      sinon.assert.notCalled(outboxRepository.markHandlerProcessed);
      sinon.assert.notCalled(outboxRepository.markAsProcessed);
      held.resolve();
      await tick;
      assertClaims(2);
      sandbox.assert.callOrder(
        handle,
        outboxRepository.markHandlerProcessed,
        outboxRepository.markAsProcessed,
      );
      sinon.assert.calledOnceWithExactly(
        outboxRepository.markHandlerProcessed,
        String(record._id),
        "held-handler",
        owner,
      );
      sinon.assert.calledOnceWithExactly(
        outboxRepository.markAsProcessed,
        String(record._id),
        owner,
      );
      sinon.assert.notCalled(outboxRepository.markAsFailed);
      expect(sandbox.clock.countTimers()).to.equal(0);
    } finally {
      held.resolve();
      await tick;
    }
  });
});
