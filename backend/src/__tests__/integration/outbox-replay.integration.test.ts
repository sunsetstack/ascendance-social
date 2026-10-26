import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { expect } from "chai";
import { after, before, describe, it } from "mocha";
import mongoose, { type Connection, type Model } from "mongoose";
import { OutboxModel, type IOutboxEvent } from "@/models/outbox.model";
import {
  MAX_OUTBOX_RETRIES,
  OutboxRepository,
} from "@/repositories/outbox.repository";

describe("Outbox replay integration", () => {
  let connection: Connection;
  let model: Model<IOutboxEvent>;
  let repository: OutboxRepository;

  before(async () => {
    const uri = process.env.INTEGRATION_MONGODB_URI;
    if (!uri) {
      throw new Error("INTEGRATION_MONGODB_URI is required for Outbox replay integration tests");
    }
    connection = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    await connection.asPromise();
    model = connection.model<IOutboxEvent>(
      "OutboxReplay",
      OutboxModel.schema,
      `outbox_replay_${randomUUID().replaceAll("-", "")}`,
    );
    repository = new OutboxRepository(model);
  });

  after(async () => {
    try {
      if (model) await model.collection.drop();
    } finally {
      await connection?.close();
    }
  });

  for (const legacy of [true, false]) {
    it(`requeues a ${legacy ? "legacy" : "modern"} exhausted record into an owned claim without losing checkpoints`, async () => {
      const immutable = {
        eventType: "ReplayTestEvent",
        payload: { payload: { id: "preserved" } },
        traceId: "replay-trace",
        correlationId: "replay-correlation",
        createdAt: new Date("2026-07-30T12:00:00.000Z"),
        processedHandlers: ["FirstHandler"],
      };
      const record = await model.create({
        ...immutable,
        processed: false,
        processing: false,
        retries: legacy ? MAX_OUTBOX_RETRIES : 0,
        ...(legacy ? {} : { exhaustedAt: new Date() }),
        nextAttemptAt: new Date(Date.now() + 3_600_000),
        processingOwner: "previous-worker",
        processingStartedAt: new Date(),
        error: "previous failure",
      });
      const eventId = String(record._id);

      expect(await repository.claimPendingEvents(1, "replay-worker", 60_000))
        .to.deep.equal([]);
      expect(await repository.requeueExhaustedEvent(eventId)).to.equal(true);

      const replayed = await model.findById(eventId).lean().exec();
      expect(replayed).to.deep.include({
        ...immutable, processed: false, processing: false, retries: 0,
      });
      for (const field of [
        "error", "exhaustedAt", "nextAttemptAt", "processingOwner", "processingStartedAt",
      ]) {
        expect(replayed).not.to.have.property(field);
      }

      const claimed = await repository.claimPendingEvents(1, "replay-worker", 60_000);
      expect(claimed).to.have.lengthOf(1);
      expect(String(claimed[0]._id)).to.equal(eventId);
      const owned = await model.findById(eventId).lean().exec();
      expect(owned).to.deep.include({
        ...immutable, processed: false, retries: 0,
        processing: true, processingOwner: "replay-worker",
      });
      expect(owned!.processingStartedAt).to.be.instanceOf(Date);
      expect(await repository.claimPendingEvents(1, "other-worker", 60_000))
        .to.deep.equal([]);

      expect(await repository.markHandlerProcessed(eventId, "SecondHandler", "previous-worker"))
        .to.equal(false);
      expect(await repository.markAsProcessed(eventId, "previous-worker"))
        .to.equal(false);
      expect(await repository.markAsProcessed(eventId, "replay-worker"))
        .to.equal(true);
      expect(await repository.claimPendingEvents(1, "other-worker", 60_000))
        .to.deep.equal([]);
    });
  }
});
