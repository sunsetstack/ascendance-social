import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "mocha";
import { expect } from "chai";
import mongoose from "mongoose";
import { ForensicOperationalErrorModel } from "@/models/forensicOperationalError.model";
import { ForensicOperationalErrorRepository } from "@/repositories/forensicOperationalError.repository";
import type { NewForensicOperationalErrorRecord } from "@/types";

const uri = process.env.INTEGRATION_MONGODB_URI;

describe("ForensicOperationalErrorRepository integration", () => {
  const runId = randomUUID();
  const firstEventId = `forensic-event-first-${runId}`;
  const duplicateEventId = `forensic-event-duplicate-${runId}`;
  const distinctEventId = `forensic-event-distinct-${runId}`;
  const sharedErrorId = `forensic-error-shared-${runId}`;
  const distinctErrorId = `forensic-error-distinct-${runId}`;
  const eventIds = [firstEventId, duplicateEventId, distinctEventId];
  const repository = new ForensicOperationalErrorRepository();
  let connectedHere = false;

  function record(
    eventId: string,
    errorId: string,
    message: string,
  ): NewForensicOperationalErrorRecord {
    return {
      schemaVersion: 1,
      eventId,
      errorId,
      eventType: "operational.error",
      occurredAt: new Date(),
      severity: "error",
      operation: "forensic-error-identity-test",
      actor: { type: "system" },
      error: { name: "Error", message },
    };
  }

  before(async () => {
    if (!uri) {
      throw new Error(
        "INTEGRATION_MONGODB_URI is required for forensic repository integration tests",
      );
    }

    if (mongoose.connection.readyState === 0) {
      connectedHere = true;
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5_000,
        connectTimeoutMS: 5_000,
      });
    }

    await ForensicOperationalErrorModel.init();
  });

  after(async () => {
    const db = mongoose.connection.db;
    if (db) {
      await db
        .collection("forensicOperationalErrors")
        .deleteMany({ eventId: { $in: eventIds } });
    }
    if (connectedHere) {
      await mongoose.disconnect();
    }
  });

  it("rejects duplicate errorId records without changing the first record", async () => {
    await repository.append(
      record(firstEventId, sharedErrorId, "first failure"),
    );

    let duplicateError: unknown;
    try {
      await repository.append(
        record(duplicateEventId, sharedErrorId, "duplicate failure"),
      );
    } catch (error) {
      duplicateError = error;
    }

    expect(duplicateError).to.be.instanceOf(Error);
    expect((duplicateError as Error).name).to.equal("DatabaseError");

    const sharedErrorRecords = await ForensicOperationalErrorModel.find({
      errorId: sharedErrorId,
    })
      .lean()
      .exec();
    expect(sharedErrorRecords).to.have.length(1);
    expect(sharedErrorRecords[0].eventId).to.equal(firstEventId);
    expect(sharedErrorRecords[0].error.message).to.equal("first failure");

    await repository.append(
      record(distinctEventId, distinctErrorId, "distinct failure"),
    );

    const distinctRecord = await ForensicOperationalErrorModel.findOne({
      errorId: distinctErrorId,
    })
      .lean()
      .exec();
    expect(distinctRecord?.eventId).to.equal(distinctEventId);
    expect(distinctRecord?.error.message).to.equal("distinct failure");
  });
});
