import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { OutboxModel } from "@/models/outbox.model";
import {
  MAX_OUTBOX_RETRIES,
  OutboxRepository,
} from "@/repositories/outbox.repository";
import { createRecord } from "../helpers/outbox-fixtures";

describe("OutboxRepository query and update contracts", () => {
  const eventId = "507f1f77bcf86cd799439011";
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  let sandbox: sinon.SinonSandbox;
  let repository: OutboxRepository;
  let updateOne: sinon.SinonStubbedFunction<typeof OutboxModel.updateOne>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.useFakeTimers({ now, toFake: ["Date"] });
    repository = new OutboxRepository(OutboxModel);
  });
  afterEach(() => sandbox.restore());

  function useUpdateResult(
    modifiedCount: number,
    matchedCount = modifiedCount,
  ): void {
    const query = OutboxModel.updateOne({}, {});
    sandbox
      .stub(query, "exec")
      .resolves({
        acknowledged: true,
        modifiedCount,
        matchedCount,
        upsertedCount: 0,
        upsertedId: null,
      });
    updateOne = sandbox.stub(OutboxModel, "updateOne").returns(query);
  }

  function assertUpdate(filter: unknown, update: unknown): void {
    sinon.assert.calledOnce(updateOne);
    expect(updateOne.firstCall.args).to.deep.equal([filter, update]);
  }

  it("constructs an atomic oldest-first claim with retry and lease eligibility", async () => {
    const query = OutboxModel.findOneAndUpdate({}, {});
    sandbox.stub(query, "exec").resolves(null);
    const claim = sandbox.stub(OutboxModel, "findOneAndUpdate").returns(query);
    expect(
      await repository.claimPendingEvents(1, "worker-1", 60_000),
    ).to.deep.equal([]);
    sinon.assert.calledOnceWithExactly(
      claim,
      {
        processed: false,
        retries: { $lt: MAX_OUTBOX_RETRIES },
        exhaustedAt: { $exists: false },
        $and: [
          {
            $or: [
              { nextAttemptAt: { $exists: false } },
              { nextAttemptAt: { $lte: new Date(now) } },
            ],
          },
          {
            $or: [
              { processing: { $ne: true } },
              { processingStartedAt: { $exists: false } },
              { processingStartedAt: { $lt: new Date(now - 60_000) } },
            ],
          },
        ],
      },
      {
        $set: {
          processing: true,
          processingOwner: "worker-1",
          processingStartedAt: new Date(now),
        },
      },
      { sort: { createdAt: 1 }, new: true },
    );
  });

  it("returns each claimed document and stops at its requested limit", async () => {
    const record = createRecord({ _id: eventId });
    const query = OutboxModel.findOneAndUpdate({}, {});
    sandbox.stub(query, "exec").resolves(record);
    const claim = sandbox.stub(OutboxModel, "findOneAndUpdate").returns(query);
    expect(
      await repository.claimPendingEvents(1, "worker", 60_000),
    ).to.deep.equal([record]);
    sinon.assert.calledOnce(claim);
  });

  it("checkpoints with an owner-qualified addToSet", async () => {
    useUpdateResult(1);
    expect(
      await repository.markHandlerProcessed(eventId, "A", "worker"),
    ).to.equal(true);
    assertUpdate(
      { _id: eventId, processingOwner: "worker" },
      { $addToSet: { processedHandlers: "A" } },
    );
  });

  it("completes with owner qualification and operational-state cleanup", async () => {
    useUpdateResult(1);
    expect(await repository.markAsProcessed(eventId, "worker")).to.equal(true);
    assertUpdate(
      { _id: eventId, processingOwner: "worker" },
      {
        $set: {
          processed: true,
          processedAt: new Date(now),
          processing: false,
        },
        $unset: {
          processingOwner: 1,
          processingStartedAt: 1,
          error: 1,
          nextAttemptAt: 1,
          exhaustedAt: 1,
        },
      },
    );
  });

  it("increments retries and schedules an owned failure without touching checkpoints", async () => {
    useUpdateResult(1);
    expect(
      await repository.markAsFailed(eventId, "failure", "worker", {
        nextAttemptAt: new Date(now + 15_000),
      }),
    ).to.equal(true);
    assertUpdate(
      { _id: eventId, processingOwner: "worker" },
      {
        $inc: { retries: 1 },
        $set: {
          error: "failure",
          processing: false,
          nextAttemptAt: new Date(now + 15_000),
        },
        $unset: { processingOwner: 1, processingStartedAt: 1, exhaustedAt: 1 },
      },
    );
  });

  it("records owned exhaustion and clears retry scheduling without touching checkpoints", async () => {
    useUpdateResult(1);
    expect(
      await repository.markAsFailed(eventId, "terminal", "worker", {
        exhaustedAt: new Date(now),
      }),
    ).to.equal(true);
    assertUpdate(
      { _id: eventId, processingOwner: "worker" },
      {
        $inc: { retries: 1 },
        $set: {
          error: "terminal",
          processing: false,
          exhaustedAt: new Date(now),
        },
        $unset: {
          processingOwner: 1,
          processingStartedAt: 1,
          nextAttemptAt: 1,
        },
      },
    );
  });

  for (const method of ["checkpoint", "completion", "failure"] as const) {
    it(`returns false for an unmodified ${method} write`, async () => {
      useUpdateResult(0);
      const result =
        method === "checkpoint"
          ? await repository.markHandlerProcessed(eventId, "A", "old")
          : method === "completion"
            ? await repository.markAsProcessed(eventId, "old")
            : await repository.markAsFailed(eventId, "failed", "old", {
                nextAttemptAt: new Date(now + 1),
              });
      expect(result).to.equal(false);
      expect(updateOne.firstCall.args[0]).to.deep.equal({
        _id: eventId,
        processingOwner: "old",
      });
    });
  }

  it("renews a live owned claim using matchedCount rather than modifiedCount", async () => {
    useUpdateResult(0, 1);
    expect(await repository.renewClaim(eventId, "worker")).to.equal(true);
    assertUpdate(
      {
        _id: eventId,
        processingOwner: "worker",
        processing: true,
        processed: false,
      },
      { $set: { processingStartedAt: new Date(now) } },
    );
  });

  it("returns false when renewal matches no live owned claim", async () => {
    useUpdateResult(0);
    expect(await repository.renewClaim(eventId, "old")).to.equal(false);
  });

  it("requeues either exhaustion form and preserves checkpoints and immutable event data", async () => {
    useUpdateResult(1);
    expect(await repository.requeueExhaustedEvent(eventId)).to.equal(true);
    assertUpdate(
      {
        _id: eventId,
        processed: false,
        processing: { $ne: true },
        $or: [
          { retries: { $gte: MAX_OUTBOX_RETRIES } },
          { exhaustedAt: { $exists: true } },
        ],
      },
      {
        $set: { retries: 0, processing: false },
        $unset: {
          error: 1,
          exhaustedAt: 1,
          nextAttemptAt: 1,
          processingOwner: 1,
          processingStartedAt: 1,
        },
      },
    );
  });

  it("reports a replay write that matched no eligible record", async () => {
    useUpdateResult(0);
    expect(await repository.requeueExhaustedEvent(eventId)).to.equal(false);
  });
});
