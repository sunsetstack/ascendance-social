import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { errorLogger, logger } from "@/utils/winston";
import { OutboxTestDatabase } from "../helpers/outbox-database";
import {
  createDeferred,
  createRecord,
  FirstTestEventHandler,
  SecondTestEventHandler,
  TestEvent,
  TestEventHandler,
  TestableOutboxWorker,
  restoreEnv,
} from "../helpers/outbox-fixtures";

describe("OutboxWorker with real repository (collection scans)", () => {
  const database = new OutboxTestDatabase();
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  const originalBaseDelay = process.env.OUTBOX_RETRY_BASE_DELAY_MS;
  const originalMaxDelay = process.env.OUTBOX_RETRY_MAX_DELAY_MS;
  const originalClaimTimeout = process.env.OUTBOX_CLAIM_TIMEOUT_MS;
  let sandbox: sinon.SinonSandbox;
  let repository: OutboxRepository;
  let eventBus: EventBus;
  let metrics: sinon.SinonStubbedInstance<MetricsService>;
  let worker: TestableOutboxWorker;

  before(async () => database.open({ createIndexes: false }));
  beforeEach(async () => {
    await database.clear();
    sandbox = sinon.createSandbox();
    sandbox.useFakeTimers({
      now,
      toFake: ["Date", "setInterval", "clearInterval"],
    });
    sandbox.stub(Math, "random").returns(0.5);
    sandbox.stub(errorLogger, "error");
    sandbox.stub(logger, "warn");
    process.env.OUTBOX_RETRY_BASE_DELAY_MS = "15000";
    process.env.OUTBOX_RETRY_MAX_DELAY_MS = "300000";
    process.env.OUTBOX_CLAIM_TIMEOUT_MS = "1000";
    repository = database.repository;
    metrics = sandbox.createStubInstance(MetricsService);
    eventBus = new EventBus(repository, metrics);
    worker = new TestableOutboxWorker(repository, eventBus, metrics);
  });
  afterEach(async () => {
    try {
      await worker.stop();
    } finally {
      sandbox.restore();
      restoreEnv("OUTBOX_RETRY_BASE_DELAY_MS", originalBaseDelay);
      restoreEnv("OUTBOX_RETRY_MAX_DELAY_MS", originalMaxDelay);
      restoreEnv("OUTBOX_CLAIM_TIMEOUT_MS", originalClaimTimeout);
    }
  });
  after(async () => database.close());

  it("persists a partial checkpoint, continues another event, delays retry and resumes only the failed handler", async () => {
    const first = await database.model.create(
      createRecord({
        payload: new TestEvent("first"),
        createdAt: new Date(now - 2),
      }).toObject(),
    );
    const second = await database.model.create(
      createRecord({
        payload: new TestEvent("second"),
        createdAt: new Date(now - 1),
      }).toObject(),
    );
    const handlerA = new FirstTestEventHandler();
    const handlerB = new SecondTestEventHandler();
    const handleA = sandbox.stub(handlerA, "handle").resolves();
    const handleB = sandbox.stub(handlerB, "handle").resolves();
    handleB.onFirstCall().rejects(new Error("B failed"));
    eventBus.subscribe(TestEvent, handlerA);
    eventBus.subscribe(TestEvent, handlerB);

    await worker.runTick();
    const failed = await database.model
      .findById(first._id)
      .orFail()
      .lean()
      .exec();
    expect(failed.processedHandlers).to.deep.equal(["FirstTestEventHandler"]);
    expect(failed).to.include({
      retries: 1,
      processed: false,
      processing: false,
      error: "B failed",
    });
    expect(failed.nextAttemptAt).to.deep.equal(new Date(now + 15_000));
    expect(failed).not.to.have.property("processingOwner");
    const completed = await database.model
      .findById(second._id)
      .orFail()
      .lean()
      .exec();
    expect(completed.processed).to.equal(true);
    expect(completed.processedHandlers).to.deep.equal([
      "FirstTestEventHandler",
      "SecondTestEventHandler",
    ]);
    expect(handleA.getCalls().map(({ args }) => args)).to.deep.equal([
      [new TestEvent("first")],
      [new TestEvent("second")],
    ]);
    sinon.assert.calledTwice(handleB);

    sandbox.clock.setSystemTime(now + 14_999);
    await worker.runTick();
    sinon.assert.calledTwice(handleA);
    sinon.assert.calledTwice(handleB);
    expect(
      await repository.claimPendingEvents(1, "early", 1_000),
    ).to.deep.equal([]);

    sandbox.clock.setSystemTime(now + 15_000);
    await worker.runTick();
    sinon.assert.calledTwice(handleA);
    sinon.assert.calledThrice(handleB);
    expect(handleB.thirdCall.args).to.deep.equal([new TestEvent("first")]);
    const resumed = await database.model
      .findById(first._id)
      .orFail()
      .lean()
      .exec();
    expect(resumed).to.include({
      processed: true,
      processing: false,
      retries: 1,
    });
    expect(resumed.processedHandlers).to.deep.equal([
      "FirstTestEventHandler",
      "SecondTestEventHandler",
    ]);
    expect(resumed.processedAt).to.deep.equal(new Date(now + 15_000));
    for (const field of [
      "error",
      "nextAttemptAt",
      "exhaustedAt",
      "processingOwner",
      "processingStartedAt",
    ])
      expect(resumed).not.to.have.property(field);
    expect(sandbox.clock.countTimers()).to.equal(0);
  });

  it("persists renewal beyond the original lease while another worker processes the next event", async () => {
    const first = await database.model.create(
      createRecord({
        payload: new TestEvent("first"),
        createdAt: new Date(now - 2),
      }).toObject(),
    );
    const second = await database.model.create(
      createRecord({
        payload: new TestEvent("second"),
        createdAt: new Date(now - 1),
      }).toObject(),
    );
    const entered = createDeferred<void>();
    const held = createDeferred<void>();
    const handler = new TestEventHandler();
    const handle = sandbox.stub(handler, "handle").callsFake(async (event) => {
      if (event.payload === "first") {
        entered.resolve();
        await held.promise;
      }
    });
    eventBus.subscribe(TestEvent, handler);
    const renewal = sandbox.spy(repository, "renewClaim");
    const claims = sandbox.spy(repository, "claimPendingEvents");
    const checkpoints = sandbox.spy(repository, "markHandlerProcessed");
    const completions = sandbox.spy(repository, "markAsProcessed");
    const failures = sandbox.spy(repository, "markAsFailed");
    const competing = new TestableOutboxWorker(repository, eventBus, metrics);
    const firstTick = worker.runTick();
    let competingTick: Promise<void> | undefined;
    try {
      await Promise.race([
        entered.promise,
        firstTick.then(() => {
          throw new Error("Worker finished without entering the held handler");
        }),
      ]);
      const owner = claims.firstCall.args[1];
      for (let index = 0; index < 3; index++) {
        await sandbox.clock.tickAsync(333);
        expect(await renewal.lastCall.returnValue).to.equal(true);
        await sandbox.clock.tickAsync(0);
      }
      await sandbox.clock.tickAsync(2);
      expect(Date.now()).to.equal(now + 1001);
      sinon.assert.calledThrice(renewal);
      const active = await database.model
        .findById(first._id)
        .orFail()
        .lean()
        .exec();
      expect(active).to.include({
        processing: true,
        processingOwner: owner,
        processed: false,
      });
      expect(active.processingStartedAt).to.deep.equal(new Date(now + 999));
      expect(active.processedHandlers).to.deep.equal([]);

      competingTick = competing.runTick();
      await competingTick;
      const competingOwner = claims.secondCall.args[1];
      expect(competingOwner)
        .to.match(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        )
        .and.not.to.equal(owner);
      expect(handle.getCalls().map(({ args }) => args)).to.deep.equal([
        [new TestEvent("first")],
        [new TestEvent("second")],
      ]);
      expect(
        (await database.model.findById(second._id).orFail().exec()).processed,
      ).to.equal(true);
      expect(
        (await database.model.findById(first._id).orFail().exec())
          .processingOwner,
      ).to.equal(owner);

      held.resolve();
      await firstTick;
      for (const record of await database.model.find().lean().exec()) {
        expect(record).to.include({ processed: true, processing: false });
        expect(record.processedHandlers).to.deep.equal(["TestEventHandler"]);
        expect(record).not.to.have.property("processingOwner");
      }
      sinon.assert.calledTwice(handle);
      expect(checkpoints.getCalls().map(({ args }) => args)).to.deep.equal([
        [String(second._id), "TestEventHandler", competingOwner],
        [String(first._id), "TestEventHandler", owner],
      ]);
      expect(completions.getCalls().map(({ args }) => args)).to.deep.equal([
        [String(second._id), competingOwner],
        [String(first._id), owner],
      ]);
      expect(claims.getCalls().map(({ args }) => args)).to.deep.equal([
        [1, owner, 1000],
        [1, competingOwner, 1000],
        [1, competingOwner, 1000],
        [1, owner, 1000],
      ]);
      sinon.assert.notCalled(failures);
      expect(sandbox.clock.countTimers()).to.equal(0);
    } finally {
      held.resolve();
      await Promise.allSettled([firstTick, competingTick]);
      await competing.stop();
    }
  });

  it("fences the former worker after a genuinely stale claim is reclaimed", async () => {
    const record = await database.model.create(
      createRecord({ payload: new TestEvent("held") }).toObject(),
    );
    const id = String(record._id);
    const entered = createDeferred<void>();
    const held = createDeferred<void>();
    const handler = new TestEventHandler();
    sandbox.stub(handler, "handle").callsFake(async () => {
      entered.resolve();
      await held.promise;
    });
    eventBus.subscribe(TestEvent, handler);
    const claim = sandbox.spy(repository, "claimPendingEvents");
    const checkpoint = sandbox.spy(repository, "markHandlerProcessed");
    const completion = sandbox.spy(repository, "markAsProcessed");
    const failure = sandbox.spy(repository, "markAsFailed");
    const info = sandbox.stub(logger, "info");
    const tick = worker.runTick();
    try {
      await Promise.race([
        entered.promise,
        tick.then(() => {
          throw new Error("Worker finished without entering the held handler");
        }),
      ]);
      const oldOwner = claim.firstCall.args[1];
      sandbox.clock.setSystemTime(now + 1001);
      const [reclaimed] = await repository.claimPendingEvents(
        1,
        "new-owner",
        1000,
      );
      expect(String(reclaimed._id)).to.equal(id);
      expect(reclaimed.processingOwner).to.equal("new-owner");
      const before = await database.model.findById(id).orFail().lean().exec();

      held.resolve();
      await tick;
      sinon.assert.calledOnceWithExactly(
        checkpoint,
        id,
        "TestEventHandler",
        oldOwner,
      );
      expect(await checkpoint.firstCall.returnValue).to.equal(false);
      sinon.assert.notCalled(completion);
      sinon.assert.calledOnce(failure);
      expect(await failure.firstCall.returnValue).to.equal(false);
      expect(await repository.markAsProcessed(id, oldOwner)).to.equal(false);
      expect(
        await repository.markAsFailed(id, "stale failure", oldOwner, {
          exhaustedAt: new Date(Date.now()),
        }),
      ).to.equal(false);
      expect(await repository.renewClaim(id, oldOwner)).to.equal(false);
      expect(
        await database.model.findById(id).orFail().lean().exec(),
      ).to.deep.equal(before);
      expect(info.getCalls().map(({ args }) => args[0])).not.to.include(
        "Outbox event processed",
      );
      expect(
        metrics.recordOutboxAttempt.getCalls().map(({ args }) => args[1]),
      ).to.deep.equal(["failed"]);
      expect(sandbox.clock.countTimers()).to.equal(0);
    } finally {
      held.resolve();
      await Promise.allSettled([tick]);
    }
  });
});

describe("OutboxWorker indexed backlog regression", () => {
  const database = new OutboxTestDatabase();
  let sandbox: sinon.SinonSandbox;
  before(async () => database.open());
  after(async () => database.close());
  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });
  afterEach(() => sandbox.restore());

  it("processes a pending record when the production schema indexes are present", async () => {
    const record = await database.model.create(createRecord().toObject());
    const repository = database.repository;
    const metrics = sandbox.createStubInstance(MetricsService);
    const bus = new EventBus(repository, metrics);
    const handler = new TestEventHandler();
    const handle = sandbox.stub(handler, "handle").resolves();
    bus.subscribe(TestEvent, handler);
    const worker = new TestableOutboxWorker(repository, bus, metrics);
    expect(await repository.countPendingEvents()).to.equal(1);
    await worker.runTick();
    sinon.assert.calledOnce(handle);
    expect(
      (await database.model.findById(record._id).orFail().exec()).processed,
    ).to.equal(true);
  });
});
