import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { ForensicOperationalErrorModel } from "@/models/forensicOperationalError.model";
import { ForensicOperationalErrorRepository } from "@/repositories/forensicOperationalError.repository";
import type { NewForensicOperationalErrorRecord } from "@/types";

describe("ForensicOperationalErrorRepository", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("declares unique eventId and errorId indexes", () => {
    const singleFieldIndexes = ForensicOperationalErrorModel.schema
      .indexes()
      .filter(([fields]) => Object.keys(fields).length === 1);
    const eventIdIndexes = singleFieldIndexes.filter(
      ([fields]) => fields.eventId === 1,
    );
    const errorIdIndexes = singleFieldIndexes.filter(
      ([fields]) => fields.errorId === 1,
    );

    expect(eventIdIndexes).to.have.length(1);
    expect(eventIdIndexes[0][1].unique).to.equal(true);
    expect(errorIdIndexes).to.have.length(1);
    expect(errorIdIndexes[0][1].unique).to.equal(true);
  });

  it("assigns recordedAt inside append and overrides injected runtime values", async () => {
    const createStub = sinon
      .stub(ForensicOperationalErrorModel, "create")
      .resolves({} as never);
    const repository = new ForensicOperationalErrorRepository();
    const record: NewForensicOperationalErrorRecord = {
      schemaVersion: 1,
      eventId: "event-123",
      errorId: "error-123",
      eventType: "operational.error",
      occurredAt: new Date("2026-08-06T12:00:00.000Z"),
      severity: "error",
      operation: "safeFireAndForget",
      actor: { type: "system" },
      error: { name: "Error", message: "failure" },
    };

    await repository.append({
      ...record,
      recordedAt: new Date("2000-01-01T00:00:00.000Z"),
    } as NewForensicOperationalErrorRecord);

    const persisted = createStub.firstCall.firstArg as Record<string, unknown>;
    expect(persisted.recordedAt).to.be.instanceOf(Date);
    expect((persisted.recordedAt as Date).toISOString()).not.to.equal(
      "2000-01-01T00:00:00.000Z",
    );
  });
});
