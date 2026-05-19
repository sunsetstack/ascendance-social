/**
 * RetryService integration tests.
 *
 * Exercises the real RetryService with controlled failures to verify:
 *   - Succeeds on the first attempt with no retries
 *   - Retries on MongoDB WriteConflict (code 112) and succeeds after recovery
 *   - Stops immediately on non-retryable errors
 *   - Exhausts max attempts and re-throws the last error
 *   - Custom shouldRetry callback overrides built-in retry detection
 *   - onRetry callback is invoked once per retry with the correct attempt number
 *   - executeAll with continueOnError returns mixed success/failure results
 *
 * No external services required.
 */

import "reflect-metadata";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import sinon from "sinon";

import { RetryService } from "@/services/retry.service";

chai.use(chaiAsPromised);

// ---------------------------------------------------------------------------
// Helper: build a MongoDB-style error with a numeric code
// ---------------------------------------------------------------------------

const mongoError = (code: number, message = "mongo error"): Error & { code: number } => {
  const err = new Error(message) as Error & { code: number };
  err.code = code;
  return err;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RetryService integration", () => {
  let service: RetryService;

  beforeEach(() => {
    service = new RetryService();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("returns the result on the first successful attempt without retrying", async () => {
    const op = sinon.stub().resolves(42);

    const result = await service.execute(op, { maxAttempts: 3 });

    expect(result).to.equal(42);
    expect(op.callCount).to.equal(1);
  });

  // -------------------------------------------------------------------------
  // Retry on retryable error (WriteConflict = code 112)
  // -------------------------------------------------------------------------

  it("retries on WriteConflict (code 112) and succeeds on the second attempt", async () => {
    const op = sinon
      .stub()
      .onFirstCall()
      .rejects(mongoError(112, "WriteConflict"))
      .onSecondCall()
      .resolves("ok");

    const result = await service.execute(op, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(result).to.equal("ok");
    expect(op.callCount).to.equal(2);
  });

  it("retries on network 'connection' errors by matching the message", async () => {
    const networkErr = new Error("connection refused");
    const op = sinon
      .stub()
      .onFirstCall()
      .rejects(networkErr)
      .onSecondCall()
      .resolves("recovered");

    const result = await service.execute(op, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    expect(result).to.equal("recovered");
    expect(op.callCount).to.equal(2);
  });

  // -------------------------------------------------------------------------
  // No retry on non-retryable errors
  // -------------------------------------------------------------------------

  it("throws immediately on a non-retryable error without retrying", async () => {
    const appErr = new Error("validation failed");
    const op = sinon.stub().rejects(appErr);

    const err = await service
      .execute(op, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 10 })
      .catch((e) => e);

    // ValidationError messages don't trigger retry; only 1 attempt made
    expect(op.callCount).to.equal(1);
    expect(err).to.equal(appErr);
  });

  // -------------------------------------------------------------------------
  // Exhaust all attempts
  // -------------------------------------------------------------------------

  it("re-throws the last error after exhausting all attempts", async () => {
    const persistentErr = mongoError(112, "WriteConflict persists");
    const op = sinon.stub().rejects(persistentErr);

    const err = await service
      .execute(op, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5 })
      .catch((e) => e);

    expect(op.callCount).to.equal(3);
    expect(err).to.equal(persistentErr);
  });

  // -------------------------------------------------------------------------
  // Custom shouldRetry callback
  // -------------------------------------------------------------------------

  it("uses custom shouldRetry to retry a normally non-retryable error", async () => {
    const customErr = new Error("custom-retryable");
    const op = sinon
      .stub()
      .onFirstCall()
      .rejects(customErr)
      .onSecondCall()
      .resolves("custom-ok");

    const result = await service.execute(op, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
      shouldRetry: () => true,
    });

    expect(result).to.equal("custom-ok");
    expect(op.callCount).to.equal(2);
  });

  it("uses custom shouldRetry to prevent retry of a normally retryable error", async () => {
    const writeConflict = mongoError(112);
    const op = sinon.stub().rejects(writeConflict);

    const err = await service
      .execute(op, {
        maxAttempts: 5,
        baseDelayMs: 1,
        maxDelayMs: 10,
        shouldRetry: () => false,
      })
      .catch((e) => e);

    expect(op.callCount).to.equal(1);
    expect(err).to.equal(writeConflict);
  });

  // -------------------------------------------------------------------------
  // onRetry callback
  // -------------------------------------------------------------------------

  it("invokes onRetry once per retry with the correct attempt number", async () => {
    const retrySpy = sinon.spy();
    const op = sinon
      .stub()
      .onCall(0).rejects(mongoError(112))
      .onCall(1).rejects(mongoError(112))
      .onCall(2).resolves("done");

    await service.execute(op, {
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
      onRetry: retrySpy,
    });

    // Two failures → two onRetry calls with attempt numbers 1 and 2
    expect(retrySpy.callCount).to.equal(2);
    expect(retrySpy.getCall(0).args[0]).to.equal(1);
    expect(retrySpy.getCall(1).args[0]).to.equal(2);
  });

  // -------------------------------------------------------------------------
  // executeAll with continueOnError
  // -------------------------------------------------------------------------

  it("executeAll returns mixed success/failure results when continueOnError is true", async () => {
    const ops = [
      () => Promise.resolve("a"),
      () => Promise.reject(new Error("op-2 failed")),
      () => Promise.resolve("c"),
    ];

    const results = await service.executeAll(ops, { continueOnError: true });

    expect(results).to.have.length(3);
    expect(results[0]).to.deep.equal({ success: true, result: "a" });
    expect(results[1].success).to.be.false;
    expect((results[1] as { success: false; error: Error }).error.message).to.equal("op-2 failed");
    expect(results[2]).to.deep.equal({ success: true, result: "c" });
  });

  it("executeAll rejects on the first failure when continueOnError is false (default)", async () => {
    const ops = [
      () => Promise.resolve("a"),
      () => Promise.reject(new Error("fatal")),
      () => Promise.resolve("c"),
    ];

    await expect(service.executeAll(ops)).to.be.rejectedWith("fatal");
  });

  it("executeAll succeeds when all operations succeed", async () => {
    const ops = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];

    const results = await service.executeAll(ops, { continueOnError: true });

    expect(results.every((r) => r.success)).to.be.true;
    const values = results.map((r) => (r as { success: true; result: number }).result);
    expect(values).to.deep.equal([1, 2, 3]);
  });
});
