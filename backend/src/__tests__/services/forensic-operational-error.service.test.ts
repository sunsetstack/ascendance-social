import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import type { IForensicOperationalErrorWriter } from "@/repositories/interfaces";
import {
  runWithRequestContext,
  setRequestContextAuthentication,
} from "@/runtime/request-context";
import { ForensicOperationalErrorService } from "@/services/forensic-operational-error.service";
import type { NewForensicOperationalErrorRecord } from "@/types";
import { AppError, ErrorCode, Errors } from "@/utils/errors";
import { errorLogger } from "@/utils/winston";

class CapturingForensicWriter implements IForensicOperationalErrorWriter {
  readonly records: NewForensicOperationalErrorRecord[] = [];

  async append(record: NewForensicOperationalErrorRecord): Promise<void> {
    this.records.push(record);
  }
}

describe("ForensicOperationalErrorService", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("persists the shared error ID and only allowlisted error context", async () => {
    const writer = new CapturingForensicWriter();
    const service = new ForensicOperationalErrorService(writer);
    const cause = Object.assign(new Error("mongo failed"), {
      name: "MongoServerError",
      code: 112,
      codeName: "WriteConflict",
      errorLabels: ["TransientTransactionError"],
    });
    const error = new AppError("PostPersistenceError", "post failed", 500, {
      errorCode: ErrorCode.DATABASE_ERROR,
      cause,
      context: {
        action: "record-post-view",
        resourceType: "Post",
        postPublicId: "11111111-1111-4111-8111-111111111111",
        errorName: "MongoServerError",
        safeButUnreviewed: "must-not-be-persisted",
        password: "must-not-be-persisted",
      },
    });

    await runWithRequestContext(
      {
        correlationId: "correlation-123",
        method: "GET",
        requestPath: "/api/posts/example",
        clientIp: "203.0.113.10",
        userAgent: "test-agent",
        clientRequestId: "client-request-123",
      },
      async () => {
        setRequestContextAuthentication({
          userId: "22222222-2222-4222-8222-222222222222",
          sessionId: "session-123",
          tokenFamilyId: "family-123",
          authSource: "access_token",
        });
        await service.record(error, {
          errorId: "33333333-3333-4333-8333-333333333333",
          operation: "safeFireAndForget",
        });
      },
    );

    expect(writer.records).to.have.length(1);
    const record = writer.records[0];
    expect(record).not.to.have.property("recordedAt");
    expect(record.errorId).to.equal(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(record.request?.correlationId).to.equal("correlation-123");
    expect(record.request?.ip).to.equal("203.0.113.10");
    expect(record.actor.userId).to.equal(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(record.session).to.deep.equal({
      sessionId: "session-123",
      tokenFamilyId: "family-123",
      authSource: "access_token",
    });
    expect(record.error.context).to.deep.equal({
      action: "record-post-view",
      resourceType: "Post",
      postPublicId: "11111111-1111-4111-8111-111111111111",
      errorName: "MongoServerError",
    });
    expect(record.error.cause?.name).to.equal("MongoServerError");
    expect(record.error.cause?.code).to.equal(112);
    expect(record.error.cause?.codeName).to.equal("WriteConflict");
  });

  it("reports duplicate errorId persistence as a writer failure", async () => {
    const errorId = "44444444-4444-4444-8444-444444444444";
    const writer: IForensicOperationalErrorWriter = {
      async append(): Promise<void> {
        throw Errors.database(
          "E11000 duplicate key error index: errorId_1 dup key",
        );
      },
    };
    const logStub = sinon.stub(errorLogger, "error");
    const service = new ForensicOperationalErrorService(writer);

    await service.record(new Error("duplicate persistence attempt"), {
      errorId,
      operation: "safeFireAndForget",
    });

    expect(logStub.calledOnce).to.equal(true);
    expect(logStub.firstCall.firstArg).to.include({
      event: "forensic_operational_error.write_failed",
      errorId,
    });
  });
});
