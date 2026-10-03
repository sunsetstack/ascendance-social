import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { z } from "zod";
import type { PipelineStage } from "mongoose";
import {
  MAX_OUTBOX_RETRIES,
  OutboxRepository,
} from "@/repositories/outbox.repository";
import { OutboxTestDatabase } from "../helpers/outbox-database";
import { createRecord } from "../helpers/outbox-fixtures";

describe("OutboxRepository persistence", () => {
  const database = new OutboxTestDatabase();
  const now = Date.parse("2026-07-30T12:00:00.000Z");
  let repository: OutboxRepository;
  let clock: sinon.SinonFakeTimers;

  before(async () => {
    await database.open();
    repository = database.repository;
  });
  beforeEach(async () => {
    await database.clear();
    clock = sinon.useFakeTimers({ now, toFake: ["Date"] });
  });
  afterEach(() => clock.restore());
  after(async () => database.close());

  const eligibilityCases = [
    { name: "missing retry timestamp", input: {}, eligible: true },
    {
      name: "past retry timestamp",
      input: { nextAttemptAt: new Date(now - 1) },
      eligible: true,
    },
    {
      name: "due retry timestamp",
      input: { nextAttemptAt: new Date(now) },
      eligible: true,
    },
    {
      name: "future retry timestamp",
      input: { nextAttemptAt: new Date(now + 1) },
      eligible: false,
    },
    { name: "processed record", input: { processed: true }, eligible: false },
    {
      name: "legacy exhaustion",
      input: { retries: MAX_OUTBOX_RETRIES },
      eligible: false,
    },
    {
      name: "explicit exhaustion",
      input: { exhaustedAt: new Date(now) },
      eligible: false,
    },
    {
      name: "fresh claim",
      input: {
        processing: true,
        processingOwner: "old",
        processingStartedAt: new Date(now),
      },
      eligible: false,
    },
    {
      name: "claim exactly at stale threshold",
      input: {
        processing: true,
        processingOwner: "old",
        processingStartedAt: new Date(now - 60_000),
      },
      eligible: false,
    },
    {
      name: "stale claim",
      input: {
        processing: true,
        processingOwner: "old",
        processingStartedAt: new Date(now - 60_001),
      },
      eligible: true,
    },
    {
      name: "claim missing its timestamp",
      input: { processing: true, processingOwner: "old" },
      eligible: true,
    },
  ];
  for (const { name, input, eligible } of eligibilityCases) {
    it(`claims according to ${name}`, async () => {
      const record = await database.model.create(
        createRecord(input).toObject(),
      );
      const claimed = await repository.claimPendingEvents(1, "new", 60_000);
      expect(claimed).to.have.lengthOf(eligible ? 1 : 0);
      const stored = await database.model.findById(record._id).orFail().exec();
      if (eligible) {
        expect(String(claimed[0]._id)).to.equal(String(record._id));
        expect(stored).to.include({ processing: true, processingOwner: "new" });
        expect(stored.processingStartedAt).to.deep.equal(new Date(now));
      } else {
        expect(stored.toObject()).to.deep.equal(record.toObject());
      }
    });
  }

  it("claims oldest createdAt first regardless of insertion order and respects the limit", async () => {
    const newest = await database.model.create(
      createRecord({ createdAt: new Date(now - 1) }).toObject(),
    );
    const oldest = await database.model.create(
      createRecord({ createdAt: new Date(now - 3) }).toObject(),
    );
    const middle = await database.model.create(
      createRecord({ createdAt: new Date(now - 2) }).toObject(),
    );
    const claimed = await repository.claimPendingEvents(2, "worker", 60_000);
    expect(claimed.map((record) => String(record._id))).to.deep.equal([
      String(oldest._id),
      String(middle._id),
    ]);
    const remaining = await repository.claimPendingEvents(1, "other", 60_000);
    expect(remaining.map((record) => String(record._id))).to.deep.equal([
      String(newest._id),
    ]);
  });

  it("atomically gives one eligible record to only one competing owner", async () => {
    await database.model.create(createRecord().toObject());
    const results = await Promise.all([
      repository.claimPendingEvents(1, "first", 60_000),
      repository.claimPendingEvents(1, "second", 60_000),
    ]);
    expect(results.map((result) => result.length).sort()).to.deep.equal([0, 1]);
    const [stored] = await database.model.find().exec();
    const claimed = results.flat();
    expect(stored.processingOwner).to.equal(claimed[0].processingOwner);
  });

  it("persists checkpoints without duplicating keys and returns a fresh snapshot on reclaim", async () => {
    const record = await database.model.create(createRecord().toObject());
    const id = String(record._id);
    const [firstClaim] = await repository.claimPendingEvents(
      1,
      "first",
      60_000,
    );
    expect(firstClaim).not.to.equal(record);
    expect(await repository.markHandlerProcessed(id, "A", "first")).to.equal(
      true,
    );
    expect(await repository.markHandlerProcessed(id, "A", "first")).to.equal(
      false,
    );
    expect(firstClaim.processedHandlers).to.deep.equal([]);
    expect(firstClaim.retries).to.equal(0);
    await repository.markAsFailed(id, "retry", "first", {
      nextAttemptAt: new Date(now + 15_000),
    });
    expect(
      await repository.claimPendingEvents(1, "second", 60_000),
    ).to.deep.equal([]);
    clock.setSystemTime(now + 15_000);
    const [retryClaim] = await repository.claimPendingEvents(
      1,
      "second",
      60_000,
    );
    expect(retryClaim).not.to.equal(firstClaim);
    expect(retryClaim).not.to.equal(record);
    expect(retryClaim.processedHandlers).to.deep.equal(["A"]);
    expect(retryClaim.retries).to.equal(1);
  });

  it("persists a retry, releases ownership and clears obsolete exhaustion", async () => {
    const record = await database.model.create(
      createRecord({
        processing: true,
        processingOwner: "worker",
        processingStartedAt: new Date(now),
        exhaustedAt: new Date(now - 1),
        processedHandlers: ["A"],
        retries: 2,
      }).toObject(),
    );
    expect(
      await repository.markAsFailed(String(record._id), "failed", "worker", {
        nextAttemptAt: new Date(now + 60_000),
      }),
    ).to.equal(true);
    const stored = await database.model
      .findById(record._id)
      .orFail()
      .lean()
      .exec();
    expect(stored).to.include({
      retries: 3,
      processing: false,
      processed: false,
      error: "failed",
    });
    expect(stored.nextAttemptAt).to.deep.equal(new Date(now + 60_000));
    expect(stored.processedHandlers).to.deep.equal(["A"]);
    for (const key of ["processingOwner", "processingStartedAt", "exhaustedAt"])
      expect(stored).not.to.have.property(key);
  });

  it("persists exhaustion and removes a previously scheduled retry", async () => {
    const record = await database.model.create(
      createRecord({
        processing: true,
        processingOwner: "worker",
        processingStartedAt: new Date(now),
        retries: MAX_OUTBOX_RETRIES - 1,
        nextAttemptAt: new Date(now),
        processedHandlers: ["A"],
      }).toObject(),
    );
    expect(
      await repository.markAsFailed(String(record._id), "terminal", "worker", {
        exhaustedAt: new Date(now),
      }),
    ).to.equal(true);
    const stored = await database.model
      .findById(record._id)
      .orFail()
      .lean()
      .exec();
    expect(stored).to.include({
      retries: MAX_OUTBOX_RETRIES,
      processing: false,
      error: "terminal",
    });
    expect(stored.exhaustedAt).to.deep.equal(new Date(now));
    expect(stored.processedHandlers).to.deep.equal(["A"]);
    for (const key of [
      "nextAttemptAt",
      "processingOwner",
      "processingStartedAt",
    ])
      expect(stored).not.to.have.property(key);
    expect(
      await repository.claimPendingEvents(1, "other", 60_000),
    ).to.deep.equal([]);
  });

  it("completes with a timestamp, preserves checkpoints and clears operational failure state", async () => {
    const record = await database.model.create(
      createRecord({
        processing: true,
        processingOwner: "worker",
        processingStartedAt: new Date(now),
        error: "old error",
        nextAttemptAt: new Date(now),
        exhaustedAt: new Date(now),
        processedHandlers: ["A"],
      }).toObject(),
    );
    expect(
      await repository.markAsProcessed(String(record._id), "worker"),
    ).to.equal(true);
    const stored = await database.model
      .findById(record._id)
      .orFail()
      .lean()
      .exec();
    expect(stored).to.include({ processed: true, processing: false });
    expect(stored.processedAt).to.deep.equal(new Date(now));
    expect(stored.processedHandlers).to.deep.equal(["A"]);
    for (const key of [
      "processingOwner",
      "processingStartedAt",
      "error",
      "nextAttemptAt",
      "exhaustedAt",
    ])
      expect(stored).not.to.have.property(key);
    expect(
      await repository.claimPendingEvents(1, "other", 60_000),
    ).to.deep.equal([]);
  });

  it("fences every former-owner write after stale takeover", async () => {
    const record = await database.model.create(
      createRecord({
        processing: true,
        processingOwner: "old",
        processingStartedAt: new Date(now - 60_001),
        processedHandlers: ["A"],
      }).toObject(),
    );
    await repository.claimPendingEvents(1, "new", 60_000);
    const before = await database.model
      .findById(record._id)
      .orFail()
      .lean()
      .exec();
    const id = String(record._id);
    expect(await repository.markHandlerProcessed(id, "B", "old")).to.equal(
      false,
    );
    expect(await repository.markAsProcessed(id, "old")).to.equal(false);
    expect(
      await repository.markAsFailed(id, "old failure", "old", {
        nextAttemptAt: new Date(now + 1),
      }),
    ).to.equal(false);
    expect(await repository.renewClaim(id, "old")).to.equal(false);
    expect(
      await database.model.findById(record._id).orFail().lean().exec(),
    ).to.deep.equal(before);
  });

  it("renews only a live unprocessed owned claim, including a matched but unchanged timestamp", async () => {
    const record = await database.model.create(createRecord().toObject());
    const id = String(record._id);
    expect(await repository.renewClaim(id, "worker")).to.equal(false);
    await repository.claimPendingEvents(1, "worker", 60_000);
    expect(await repository.renewClaim(id, "worker")).to.equal(true);
    clock.setSystemTime(now + 1_000);
    expect(await repository.renewClaim(id, "worker")).to.equal(true);
    expect(
      (await database.model.findById(id).orFail().exec()).processingStartedAt,
    ).to.deep.equal(new Date(now + 1_000));
    await repository.markAsProcessed(id, "worker");
    expect(await repository.renewClaim(id, "worker")).to.equal(false);
  });

  it("classifies delayed and claimed records as pending, counts both exhaustion forms and uses minimum createdAt", async () => {
    await database.model.create([
      createRecord({ createdAt: new Date(now - 10) }).toObject(),
      createRecord({
        createdAt: new Date(now - 30),
        nextAttemptAt: new Date(now + 100_000),
      }).toObject(),
      createRecord({
        createdAt: new Date(now - 20),
        processing: true,
        processingOwner: "worker",
        processingStartedAt: new Date(now),
      }).toObject(),
      createRecord({ retries: MAX_OUTBOX_RETRIES }).toObject(),
      createRecord({ exhaustedAt: new Date(now) }).toObject(),
      createRecord({ processed: true, retries: MAX_OUTBOX_RETRIES }).toObject(),
    ]);
    expect(await repository.countPendingEvents()).to.equal(3);
    expect(await repository.getBacklogStats()).to.deep.equal({
      pendingCount: 3,
      exhaustedCount: 2,
      oldestPendingAt: new Date(now - 30),
    });
  });

  it("returns zero backlog counts and no oldest timestamp for an empty collection", async () => {
    expect(await repository.getBacklogStats()).to.deep.equal({
      pendingCount: 0,
      exhaustedCount: 0,
      oldestPendingAt: undefined,
    });
  });

  const missingExhaustion = createRecord({
    createdAt: new Date(now - 10),
  }).toObject();
  const nullExhaustion = {
    ...createRecord({ createdAt: new Date(now - 30) }).toObject(),
    exhaustedAt: null,
  };
  const retryExhaustion = createRecord({
    retries: MAX_OUTBOX_RETRIES,
    createdAt: new Date(now - 100),
  }).toObject();
  const aboveLimitExhaustion = {
    ...createRecord({
      retries: MAX_OUTBOX_RETRIES + 1,
      createdAt: new Date(now - 150),
    }).toObject(),
    exhaustedAt: null,
  };
  const datedExhaustion = createRecord({
    exhaustedAt: new Date(now),
    createdAt: new Date(now - 200),
  }).toObject();
  const processedRecord = createRecord({
    processed: true,
    createdAt: new Date(now - 300),
  }).toObject();
  const processedExhaustion = createRecord({
    processed: true,
    retries: MAX_OUTBOX_RETRIES,
    exhaustedAt: new Date(now),
    createdAt: new Date(now - 400),
  }).toObject();

  const backlogCases = [
    {
      name: "a missing exhaustion timestamp",
      records: [missingExhaustion],
      pendingCount: 1,
      exhaustedCount: 0,
      oldestPendingAt: new Date(now - 10),
    },
    {
      name: "an explicit null exhaustion timestamp",
      records: [nullExhaustion],
      pendingCount: 1,
      exhaustedCount: 0,
      oldestPendingAt: new Date(now - 30),
    },
    {
      name: "retry-count exhaustion",
      records: [retryExhaustion],
      pendingCount: 0,
      exhaustedCount: 1,
      oldestPendingAt: undefined,
    },
    {
      name: "dated exhaustion",
      records: [datedExhaustion],
      pendingCount: 0,
      exhaustedCount: 1,
      oldestPendingAt: undefined,
    },
    {
      name: "retries above the limit with a null exhaustion timestamp",
      records: [aboveLimitExhaustion],
      pendingCount: 0,
      exhaustedCount: 1,
      oldestPendingAt: undefined,
    },
    {
      name: "processed records including exhaustion",
      records: [processedRecord, processedExhaustion],
      pendingCount: 0,
      exhaustedCount: 0,
      oldestPendingAt: undefined,
    },
    {
      name: "mixed records with an older null pending timestamp",
      records: [
        missingExhaustion,
        datedExhaustion,
        processedRecord,
        nullExhaustion,
        retryExhaustion,
        aboveLimitExhaustion,
        processedExhaustion,
      ],
      pendingCount: 2,
      exhaustedCount: 3,
      oldestPendingAt: new Date(now - 30),
    },
  ];

  for (const scenario of backlogCases) {
    it(`classifies ${scenario.name} identically across backlog execution plans`, async () => {
      await database.model.collection.insertMany(scenario.records);
      const stored = await database.model.collection.find({}).toArray();
      if (scenario.records.some(({ _id }) => _id.equals(missingExhaustion._id))) {
        expect(
          stored.find((record) => record._id.equals(missingExhaustion._id)),
        ).not.to.have.property("exhaustedAt");
      }
      if (scenario.records.some(({ _id }) => _id.equals(nullExhaustion._id))) {
        expect(
          stored.find((record) => record._id.equals(nullExhaustion._id)),
        ).to.have.property("exhaustedAt", null);
      }

      const expected = {
        pendingCount: scenario.pendingCount,
        exhaustedCount: scenario.exhaustedCount,
        oldestPendingAt: scenario.oldestPendingAt,
      };
      const aggregate = sinon.spy(database.model, "aggregate");
      let pipeline: PipelineStage[];
      try {
        expect(await repository.getBacklogStats()).to.deep.equal(expected);
        const captured = aggregate.firstCall.args[0];
        if (!captured) throw new Error("Backlog pipeline was not captured");
        pipeline = captured;
      } finally {
        aggregate.restore();
      }

      for (const hint of [undefined, { processed: 1 }, { $natural: 1 }]) {
        const query = database.model.aggregate<{
          pending: Array<{ count: number; oldestPendingAt: Date }>;
          exhausted: Array<{ count: number }>;
        }>(pipeline);
        if (hint) query.hint(hint);
        const [result] = await query.exec();
        const actual = {
          pendingCount: result?.pending[0]?.count ?? 0,
          exhaustedCount: result?.exhausted[0]?.count ?? 0,
          oldestPendingAt: result?.pending[0]?.oldestPendingAt,
        };
        expect(actual).to.deep.equal(expected);

        const explain = z
          .object({
            serverInfo: z.object({ version: z.string() }),
            stages: z.array(
              z.object({
                $cursor: z
                  .object({
                    queryPlanner: z.object({ winningPlan: z.unknown() }),
                    executionStats: z.object({
                      nReturned: z.number(),
                      totalKeysExamined: z.number(),
                      totalDocsExamined: z.number(),
                    }),
                  })
                  .optional(),
              }),
            ),
          })
          .parse(await query.explain("executionStats"));
        const cursor = explain.stages.find((stage) => stage.$cursor)?.$cursor;
        if (!cursor) throw new Error("Backlog explain did not contain a cursor");
        const stages: string[] = [];
        let plan: unknown = cursor.queryPlanner.winningPlan;
        while (plan !== undefined) {
          const node = z
            .object({
              stage: z.string(),
              inputStage: z.unknown().optional(),
            })
            .parse(plan);
          stages.push(node.stage);
          plan = node.inputStage;
        }
        const unprocessedCount = scenario.records.filter(
          (record) => !record.processed,
        ).length;
        expect(cursor.executionStats.nReturned).to.equal(unprocessedCount);
        if (hint?.processed) {
          expect(stages).to.include("IXSCAN").and.include("FETCH");
          expect(cursor.executionStats.totalDocsExamined).to.equal(
            unprocessedCount,
          );
        } else if (hint?.$natural) {
          expect(stages).to.include("COLLSCAN").and.not.include("IXSCAN");
          expect(cursor.executionStats.totalKeysExamined).to.equal(0);
          expect(cursor.executionStats.totalDocsExamined).to.equal(
            scenario.records.length,
          );
        } else if (stages.includes("PROJECTION_COVERED")) {
          expect(stages).to.include("IXSCAN").and.not.include("FETCH");
          expect(cursor.executionStats.totalDocsExamined).to.equal(0);
        }
        console.log(
          "Backlog execution plan",
          JSON.stringify({
            scenario: scenario.name,
            hint: hint ?? "unhinted",
            version: explain.serverInfo.version,
            winningPlan: cursor.queryPlanner.winningPlan,
            ...cursor.executionStats,
            result: actual,
          }),
        );
      }
      expect(await database.model.collection.find({}).toArray()).to.deep.equal(
        stored,
      );
    });
  }

  for (const scenario of ["processed", "non-exhausted", "active"] as const) {
    it(`rejects replay of a ${scenario} record in MongoDB`, async () => {
      const record = await database.model.create(
        createRecord({
          processed: scenario === "processed",
          processing: scenario === "active",
          retries:
            scenario === "non-exhausted"
              ? MAX_OUTBOX_RETRIES - 1
              : MAX_OUTBOX_RETRIES,
        }).toObject(),
      );
      expect(
        await repository.requeueExhaustedEvent(String(record._id)),
      ).to.equal(false);
      expect(
        (await database.model.findById(record._id).orFail().exec()).toObject(),
      ).to.deep.equal(record.toObject());
    });
  }
});
