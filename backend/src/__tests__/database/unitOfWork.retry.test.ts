import "reflect-metadata";
import { afterEach, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { ClientSession } from "mongoose";
import { UnitOfWork } from "@/database/UnitOfWork";
import { AmbiguousTransactionCommitError } from "@/database/transaction-errors";
import {
  backoffWithJitter,
  isTransientTransactionError,
  isUnknownTransactionCommitResult,
} from "@/database/transaction-retry";
import {
  TransactionSemaphore,
  TransactionSemaphoreTimeoutError,
} from "@/database/transaction-semaphore";
import { getErrorCode, getErrorLabels, getErrorMessage } from "@/utils/errors";

type FinalOutcome =
  | { kind: "pending" }
  | { kind: "value"; value: unknown }
  | {
      kind: "error";
      name: string;
      message: string;
      code?: number | string;
      labels: string[];
    };

interface FaultEvidence {
  bodyInvocationCount: number;
  commitInvocationCount: number;
  abortInvocationCount: number;
  sessionStartCount: number;
  sessionEndCount: number;
  semaphoreAcquireCount: number;
  semaphoreReleaseCount: number;
  backoffInvocationCount: number;
  retryClassification: string[];
  transactionalSideEffectCount: number;
  finalOutcome: FinalOutcome;
  finalError?: unknown;
}

interface SessionFaultPlan {
  start?: (session: ClientSession) => void;
  commit?: (invocation: number) => Promise<void> | void;
  abort?: (invocation: number) => Promise<void> | void;
}

const activeClients: mongoose.mongo.MongoClient[] = [];

function createEvidence(): FaultEvidence {
  return {
    bodyInvocationCount: 0,
    commitInvocationCount: 0,
    abortInvocationCount: 0,
    sessionStartCount: 0,
    sessionEndCount: 0,
    semaphoreAcquireCount: 0,
    semaphoreReleaseCount: 0,
    backoffInvocationCount: 0,
    retryClassification: [],
    transactionalSideEffectCount: 0,
    finalOutcome: { kind: "pending" },
  };
}

function errorClassification(error: unknown): string {
  if (isUnknownTransactionCommitResult(error)) {
    return "unknown-commit-result";
  }
  if (isTransientTransactionError(error)) {
    return "transient-transaction";
  }
  if (getErrorCode(error) === 11000) {
    return "duplicate-key";
  }
  return "definite";
}

function describeFinalError(error: unknown): FinalOutcome {
  return {
    kind: "error",
    name:
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      typeof error.name === "string"
        ? error.name
        : "Error",
    message: getErrorMessage(error),
    code: getErrorCode(error),
    labels: getErrorLabels(error) ?? [],
  };
}

async function captureOutcome<T>(
  evidence: FaultEvidence,
  operation: Promise<T>,
): Promise<T | undefined> {
  try {
    const value = await operation;
    evidence.finalOutcome = { kind: "value", value };
    return value;
  } catch (error) {
    evidence.finalError = error;
    evidence.finalOutcome = describeFinalError(error);
    return undefined;
  }
}

function createMongoError(
  message: string,
  code: number,
  label?: "TransientTransactionError" | "UnknownTransactionCommitResult",
): mongoose.mongo.MongoServerError {
  const error = new mongoose.mongo.MongoServerError({ message, code });
  if (label) error.addErrorLabel(label);
  return error;
}

function transitionToCommitted(session: ClientSession): void {
  const transaction = (
    session as ClientSession & {
      transaction: { state: string; transition(nextState: string): void };
    }
  ).transaction;
  if (transaction.state !== "TRANSACTION_COMMITTED") {
    transaction.transition("TRANSACTION_COMMITTED");
  }
}

function createInstrumentedSession(
  evidence: FaultEvidence,
  plan: SessionFaultPlan = {},
): ClientSession {
  const client = new mongoose.mongo.MongoClient("mongodb://127.0.0.1:27017");
  activeClients.push(client);
  const session = client.startSession();
  const originalStart = session.startTransaction.bind(session);
  const originalAbort = session.abortTransaction.bind(session);
  const originalEnd = session.endSession.bind(session);

  if (plan.start) {
    sinon.stub(session, "startTransaction").callsFake((options) => {
      plan.start!(session);
      originalStart(options);
    });
  }

  sinon.stub(session, "commitTransaction").callsFake(async () => {
    evidence.commitInvocationCount++;
    try {
      await plan.commit?.(evidence.commitInvocationCount);
    } catch (error) {
      evidence.retryClassification.push(
        `commit:${errorClassification(error)}`,
      );
      throw error;
    } finally {
      transitionToCommitted(session);
    }
  });

  sinon.stub(session, "abortTransaction").callsFake(async (...args: unknown[]) => {
    evidence.abortInvocationCount++;
    try {
      await plan.abort?.(evidence.abortInvocationCount);
    } catch (error) {
      evidence.retryClassification.push("abort:failure");
      await (originalAbort as (...options: unknown[]) => Promise<void>)(...args);
      throw error;
    }
    await (originalAbort as (...options: unknown[]) => Promise<void>)(...args);
  });

  sinon.stub(session, "endSession").callsFake(async (...args: unknown[]) => {
    evidence.sessionEndCount++;
    await (originalEnd as (...options: unknown[]) => Promise<void>)(...args);
  });

  return session;
}

function installSessionFactory(
  evidence: FaultEvidence,
  planFactory: (sessionNumber: number) => SessionFaultPlan = () => ({}),
  observeSession?: (session: ClientSession) => void,
): void {
  sinon.stub(mongoose, "startSession").callsFake(async () => {
    evidence.sessionStartCount++;
    const session = createInstrumentedSession(
      evidence,
      planFactory(evidence.sessionStartCount),
    );
    observeSession?.(session);
    return session;
  });
}

function instrumentBody<T>(
  evidence: FaultEvidence,
  work: (invocation: number, session: ClientSession) => Promise<T>,
): (session: ClientSession) => Promise<T> {
  return async (session) => {
    evidence.bodyInvocationCount++;
    try {
      return await work(evidence.bodyInvocationCount, session);
    } catch (error) {
      evidence.retryClassification.push(`body:${errorClassification(error)}`);
      throw error;
    }
  };
}

function createUnitOfWorkHarness(evidence: FaultEvidence): UnitOfWork {
  const unitOfWork = new UnitOfWork();
  const transactionSemaphore = (
    unitOfWork as unknown as {
      transactionSemaphore: {
        acquire(timeoutMs?: number): Promise<void>;
        release(): void;
      };
    }
  ).transactionSemaphore;
  const originalAcquire = transactionSemaphore.acquire.bind(
    transactionSemaphore,
  );
  const originalRelease = transactionSemaphore.release.bind(
    transactionSemaphore,
  );
  const originalClassifier = (
    unitOfWork as unknown as { isRetryableError(error: unknown): boolean }
  ).isRetryableError.bind(unitOfWork);

  sinon.stub(transactionSemaphore, "acquire").callsFake(async (timeoutMs) => {
    evidence.semaphoreAcquireCount++;
    await originalAcquire(timeoutMs);
  });
  sinon.stub(transactionSemaphore, "release").callsFake(() => {
    evidence.semaphoreReleaseCount++;
    originalRelease();
  });
  sinon
    .stub(unitOfWork as unknown as { isRetryableError(error: unknown): boolean }, "isRetryableError")
    .callsFake((error: unknown) => {
      const retryable = originalClassifier(error);
      evidence.retryClassification.push(
        `unit-of-work:${retryable ? "retryable" : "non-retryable"}:${errorClassification(error)}`,
      );
      return retryable;
    });
  sinon
    .stub(
      unitOfWork as unknown as {
        backoffWithJitter(
          attempt: number,
          baseMs: number,
          maxMs: number,
        ): Promise<void>;
      },
      "backoffWithJitter",
    )
    .callsFake(async () => {
      evidence.backoffInvocationCount++;
    });

  return unitOfWork;
}

function evidenceMessage(evidence: FaultEvidence): string {
  return JSON.stringify(evidence, (_key, value) =>
    value instanceof Error
      ? {
          name: value.name,
          message: value.message,
          code: getErrorCode(value),
          labels: getErrorLabels(value) ?? [],
        }
      : value,
  );
}

describe("UnitOfWork deterministic transaction fault injection", () => {
  beforeEach(() => {
    (mongoose.connection as unknown as { readyState: number }).readyState = 1;
  });

  afterEach(async () => {
    sinon.restore();
    await Promise.all(
      activeClients.splice(0).map((client) =>
        client.close().catch(() => undefined),
      ),
    );
    (mongoose.connection as unknown as { readyState: number }).readyState = 0;
    delete process.env.MAX_CONCURRENT_TRANSACTIONS;
    delete process.env.MAX_CONCURRENT_READS;
  });

  it("1. returns the value when the transaction body succeeds first try", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    installSessionFactory(evidence);

    const result = await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "committed"),
      ),
    );

    expect(result).to.equal("committed");
    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      finalOutcome: { kind: "value", value: "committed" },
    });
  });

  it("2. retries a transient transaction body error and then succeeds", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const transient = createMongoError(
      "body transient",
      112,
      "TransientTransactionError",
    );
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async (invocation) => {
          if (invocation === 1) throw transient;
          return "retried";
        }),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 2,
      commitInvocationCount: 1,
      abortInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 1,
      retryClassification: [
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
      ],
      finalOutcome: { kind: "value", value: "retried" },
    });
  });

  it("3. stops retrying a transient body error at UnitOfWork exhaustion", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const transient = createMongoError(
      "body retry exhausted",
      112,
      "TransientTransactionError",
    );
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          throw transient;
        }),
        { maxBodyAttempts: 3, maxCommitAttempts: 5 },
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 3,
      abortInvocationCount: 3,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 2,
      retryClassification: [
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
      ],
      finalOutcome: describeFinalError(transient),
      finalError: transient,
    });
  });

  it("4. retries an unknown commit result without rerunning the body", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const ambiguous = createMongoError(
      "commit acknowledgement lost",
      91,
      "UnknownTransactionCommitResult",
    );
    installSessionFactory(evidence, () => ({
      commit: async (invocation) => {
        if (invocation === 1) throw ambiguous;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "committed"),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 2,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 1,
      retryClassification: ["commit:unknown-commit-result"],
      finalOutcome: { kind: "value", value: "committed" },
    });
  });

  it("5. exhausts unknown commit retries without rerunning the body", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const ambiguous = createMongoError(
      "commit remains ambiguous",
      91,
      "UnknownTransactionCommitResult",
    );
    installSessionFactory(evidence, () => ({
      commit: async () => {
        throw ambiguous;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          evidence.transactionalSideEffectCount++;
          return "body-result";
        }),
        { maxBodyAttempts: 4, maxCommitAttempts: 3 },
      ),
    );

    const finalError = evidence.finalError as AmbiguousTransactionCommitError;
    expect(finalError).to.be.instanceOf(AmbiguousTransactionCommitError);
    expect(finalError.cause).to.equal(ambiguous);
    expect(finalError.commitAttempts).to.equal(3);
    expect(evidence, evidenceMessage(evidence)).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 3,
      abortInvocationCount: 0,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 2,
      retryClassification: [
        "commit:unknown-commit-result",
        "commit:unknown-commit-result",
        "commit:unknown-commit-result",
      ],
      transactionalSideEffectCount: 1,
      finalOutcome: describeFinalError(finalError),
      finalError,
    });
  });

  it("treats a nested unknown commit as ambiguous without restarting the body", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const unknown = createMongoError(
      "nested commit acknowledgement lost",
      91,
      "UnknownTransactionCommitResult",
    );
    const middle = new Error("middle commit wrapper", { cause: unknown });
    const outer = Object.assign(
      new Error("outer transient wrapper", { cause: middle }),
      { errorLabels: ["TransientTransactionError"] },
    );
    let startTransactionCount = 0;
    installSessionFactory(evidence, () => ({
      start: () => {
        startTransactionCount++;
      },
      commit: async () => {
        throw outer;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "body-result"),
        { maxBodyAttempts: 4, maxCommitAttempts: 2 },
      ),
    );

    const finalError = evidence.finalError as AmbiguousTransactionCommitError;
    expect(finalError).to.be.instanceOf(AmbiguousTransactionCommitError);
    expect(finalError.cause).to.equal(outer);
    expect(outer.cause).to.equal(middle);
    expect(middle.cause).to.equal(unknown);
    expect(finalError.commitAttempts).to.equal(2);
    expect(startTransactionCount).to.equal(1);
    expect(evidence, evidenceMessage(evidence)).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 2,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 1,
      retryClassification: [
        "commit:unknown-commit-result",
        "commit:unknown-commit-result",
      ],
      finalOutcome: describeFinalError(finalError),
      finalError,
    });
  });

  it("stops immediately when an unknown commit result is MaxTimeMSExpired", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const maxTime = createMongoError(
      "commit exceeded maxTimeMS",
      50,
      "UnknownTransactionCommitResult",
    );
    let startTransactionCount = 0;
    installSessionFactory(evidence, () => ({
      start: () => {
        startTransactionCount++;
      },
      commit: async () => {
        throw maxTime;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "body-result"),
        { maxBodyAttempts: 4, maxCommitAttempts: 5 },
      ),
    );

    const finalError = evidence.finalError as AmbiguousTransactionCommitError;
    expect(finalError).to.be.instanceOf(AmbiguousTransactionCommitError);
    expect(finalError.cause).to.equal(maxTime);
    expect(finalError.commitAttempts).to.equal(1);
    expect(startTransactionCount).to.equal(1);
    expect(evidence, evidenceMessage(evidence)).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: ["commit:unknown-commit-result"],
      finalOutcome: describeFinalError(finalError),
      finalError,
    });
  });

  it("detects nested MaxTimeMSExpired evidence on an unknown commit", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const maxTime = new mongoose.mongo.MongoServerError({
      message: "nested commit max time",
      codeName: "MaxTimeMSExpired",
    });
    const unknown = createMongoError(
      "nested unknown commit result",
      91,
      "UnknownTransactionCommitResult",
    );
    Object.defineProperty(unknown, "cause", { value: maxTime });
    const outer = new Error("wrapped commit failure", { cause: unknown });
    let startTransactionCount = 0;
    installSessionFactory(evidence, () => ({
      start: () => {
        startTransactionCount++;
      },
      commit: async () => {
        throw outer;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "body-result"),
        { maxBodyAttempts: 4, maxCommitAttempts: 5 },
      ),
    );

    const finalError = evidence.finalError as AmbiguousTransactionCommitError;
    expect(finalError).to.be.instanceOf(AmbiguousTransactionCommitError);
    expect(finalError.cause).to.equal(outer);
    expect(outer.cause).to.equal(unknown);
    expect(unknown.cause).to.equal(maxTime);
    expect(finalError.commitAttempts).to.equal(1);
    expect(startTransactionCount).to.equal(1);
    expect(evidence, evidenceMessage(evidence)).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: ["commit:unknown-commit-result"],
      finalOutcome: describeFinalError(finalError),
      finalError,
    });
  });

  it("does not retry a plain callback Error with retry-looking text", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const bodyFailure = new Error("network error after side effect");
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          throw bodyFailure;
        }),
        { maxBodyAttempts: 3 },
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      abortInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: [
        "body:definite",
        "unit-of-work:non-retryable:definite",
      ],
      finalOutcome: describeFinalError(bodyFailure),
      finalError: bodyFailure,
    });
  });

  it("does not retry a non-Error callback rejection with retry-looking text", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const thrownValue = "network error after side effect; please retry";
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          throw thrownValue;
        }),
        { maxBodyAttempts: 3 },
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      abortInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: [
        "body:definite",
        "unit-of-work:non-retryable:definite",
      ],
      finalOutcome: describeFinalError(thrownValue),
      finalError: thrownValue,
    });
  });

  it("6. propagates a definite non-retryable commit failure", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const commitFailure = createMongoError("definite commit failure", 121);
    installSessionFactory(evidence, () => ({
      commit: async () => {
        throw commitFailure;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "uncommitted"),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: [
        "commit:definite",
        "unit-of-work:non-retryable:definite",
      ],
      finalOutcome: describeFinalError(commitFailure),
      finalError: commitFailure,
    });
  });

  it("restarts the body after a direct transient commit failure only after the prior transaction ended", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const transient = createMongoError(
      "commit transaction transiently failed",
      112,
      "TransientTransactionError",
    );
    const statesBeforeStart: string[] = [];
    installSessionFactory(evidence, () => ({
      start: (session) => {
        statesBeforeStart.push(
          (
            session as ClientSession & {
              transaction: { state: string };
            }
          ).transaction.state,
        );
      },
      commit: async (invocation) => {
        if (invocation === 1) throw transient;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async (invocation) => `body-${invocation}`),
        { maxBodyAttempts: 3 },
      ),
    );

    expect(statesBeforeStart).to.deep.equal([
      "NO_TRANSACTION",
      "TRANSACTION_COMMITTED",
    ]);
    expect(evidence, evidenceMessage(evidence)).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 2,
      commitInvocationCount: 2,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 1,
      retryClassification: [
        "commit:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
      ],
      finalOutcome: { kind: "value", value: "body-2" },
    });
  });

  it("7. does not duplicate callback side effects during commit-only retry", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const ambiguous = createMongoError(
      "commit response dropped once",
      91,
      "UnknownTransactionCommitResult",
    );
    installSessionFactory(evidence, () => ({
      commit: async (invocation) => {
        if (invocation === 1) throw ambiguous;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          evidence.transactionalSideEffectCount++;
          return "one-side-effect";
        }),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 2,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 1,
      retryClassification: ["commit:unknown-commit-result"],
      transactionalSideEffectCount: 1,
      finalOutcome: { kind: "value", value: "one-side-effect" },
    });
  });

  it("9. preserves the body error when abort rejects after ending the transaction", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const bodyFailure = new Error("original body failure");
    const abortFailure = new Error("abort failed");
    let fakeSession: ClientSession | undefined;
    installSessionFactory(
      evidence,
      () => ({
        abort: async (invocation) => {
          if (invocation === 1) throw abortFailure;
        },
      }),
      (session) => {
        fakeSession = session;
      },
    );

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          throw bodyFailure;
        }),
        { maxBodyAttempts: 1 },
      ),
    );

    const expected = {
      ...createEvidence(),
      bodyInvocationCount: 1,
      abortInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: [
        "body:definite",
        "abort:failure",
        "unit-of-work:non-retryable:definite",
      ],
      finalOutcome: describeFinalError(bodyFailure),
      finalError: bodyFailure,
    };
    expect(evidence, evidenceMessage(evidence)).to.deep.equal(expected);
    expect(fakeSession?.inTransaction()).to.equal(false);
    expect(
      (
        fakeSession as ClientSession & {
          transaction: { state: string };
        }
      ).transaction.state,
    ).to.equal("TRANSACTION_ABORTED");
  });

  for (const [configuredLimit, expectedAttempts] of [
    [0, 1],
    [-2, 1],
    [2.9, 2],
    [Number.NaN, 8],
    [Number.POSITIVE_INFINITY, 8],
  ] as const) {
    it(`normalizes maxBodyAttempts=${String(configuredLimit)} to ${expectedAttempts} attempts`, async () => {
      const evidence = createEvidence();
      const unitOfWork = createUnitOfWorkHarness(evidence);
      const transient = createMongoError(
        "normalized body retry limit",
        112,
        "TransientTransactionError",
      );
      installSessionFactory(evidence);

      await captureOutcome(
        evidence,
        unitOfWork.executeInTransaction(
          instrumentBody(evidence, async () => {
            throw transient;
          }),
          { maxBodyAttempts: configuredLimit },
        ),
      );

      expect(evidence.bodyInvocationCount).to.equal(expectedAttempts);
      expect(evidence.abortInvocationCount).to.equal(expectedAttempts);
      expect(evidence.backoffInvocationCount).to.equal(expectedAttempts - 1);
      expect(evidence.finalError).to.equal(transient);
    });
  }

  for (const [configuredLimit, expectedAttempts] of [
    [0, 1],
    [-2, 1],
    [2.9, 2],
    [Number.NaN, 8],
    [Number.POSITIVE_INFINITY, 8],
  ] as const) {
    it(`normalizes maxCommitAttempts=${String(configuredLimit)} to ${expectedAttempts} attempts`, async () => {
      const evidence = createEvidence();
      const unitOfWork = createUnitOfWorkHarness(evidence);
      const ambiguous = createMongoError(
        "normalized commit retry limit",
        91,
        "UnknownTransactionCommitResult",
      );
      installSessionFactory(evidence, () => ({
        commit: async () => {
          throw ambiguous;
        },
      }));

      await captureOutcome(
        evidence,
        unitOfWork.executeInTransaction(
          instrumentBody(evidence, async () => "body-result"),
          { maxCommitAttempts: configuredLimit },
        ),
      );

      const finalError = evidence.finalError as AmbiguousTransactionCommitError;
      expect(finalError).to.be.instanceOf(AmbiguousTransactionCommitError);
      expect(finalError.commitAttempts).to.equal(expectedAttempts);
      expect(finalError.cause).to.equal(ambiguous);
      expect(evidence.bodyInvocationCount).to.equal(1);
      expect(evidence.commitInvocationCount).to.equal(expectedAttempts);
      expect(evidence.backoffInvocationCount).to.equal(expectedAttempts - 1);
    });
  }

  it("does not back off after the final body or commit attempt", async () => {
    const bodyEvidence = createEvidence();
    const bodyUnitOfWork = createUnitOfWorkHarness(bodyEvidence);
    const bodyFailure = createMongoError(
      "final body attempt",
      112,
      "TransientTransactionError",
    );
    installSessionFactory(bodyEvidence);

    await captureOutcome(
      bodyEvidence,
      bodyUnitOfWork.executeInTransaction(
        instrumentBody(bodyEvidence, async () => {
          throw bodyFailure;
        }),
        { maxBodyAttempts: 1 },
      ),
    );
    expect(bodyEvidence.backoffInvocationCount).to.equal(0);

    sinon.restore();
    const commitEvidence = createEvidence();
    const commitUnitOfWork = createUnitOfWorkHarness(commitEvidence);
    const commitFailure = createMongoError(
      "final commit attempt",
      91,
      "UnknownTransactionCommitResult",
    );
    installSessionFactory(commitEvidence, () => ({
      commit: async () => {
        throw commitFailure;
      },
    }));

    await captureOutcome(
      commitEvidence,
      commitUnitOfWork.executeInTransaction(
        instrumentBody(commitEvidence, async () => "body-result"),
        { maxCommitAttempts: 1 },
      ),
    );
    expect(commitEvidence.backoffInvocationCount).to.equal(0);
  });

  it("10. ends the created session exactly once", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => undefined),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      finalOutcome: { kind: "value", value: undefined },
    });
  });

  it("11. releases the semaphore permit after success", async () => {
    process.env.MAX_CONCURRENT_TRANSACTIONS = "1";
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "ok"),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      finalOutcome: { kind: "value", value: "ok" },
    });
    expect(unitOfWork.getMetrics().availablePermits).to.equal(1);
  });

  it("12. releases the semaphore permit after body failure", async () => {
    process.env.MAX_CONCURRENT_TRANSACTIONS = "1";
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const bodyFailure = new Error("body failed");
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => {
          throw bodyFailure;
        }),
        { maxBodyAttempts: 1 },
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      abortInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: [
        "body:definite",
        "unit-of-work:non-retryable:definite",
      ],
      finalOutcome: describeFinalError(bodyFailure),
      finalError: bodyFailure,
    });
    expect(unitOfWork.getMetrics().availablePermits).to.equal(1);
  });

  it("13. releases the semaphore permit after commit failure", async () => {
    process.env.MAX_CONCURRENT_TRANSACTIONS = "1";
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const commitFailure = createMongoError("commit rejected", 121);
    installSessionFactory(evidence, () => ({
      commit: async () => {
        throw commitFailure;
      },
    }));

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "not committed"),
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 1,
      commitInvocationCount: 1,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      retryClassification: [
        "commit:definite",
        "unit-of-work:non-retryable:definite",
      ],
      finalOutcome: describeFinalError(commitFailure),
      finalError: commitFailure,
    });
    expect(unitOfWork.getMetrics().availablePermits).to.equal(1);
  });

  it("14. does not leak a permit or session when queue acquisition times out", async () => {
    process.env.MAX_CONCURRENT_TRANSACTIONS = "1";
    const evidence = createEvidence();
    const unitOfWork = new UnitOfWork();
    const transactionSemaphore = (
      unitOfWork as unknown as {
        transactionSemaphore: {
          acquire(timeoutMs?: number): Promise<void>;
          release(): void;
        };
      }
    ).transactionSemaphore;
    const originalAcquire = transactionSemaphore.acquire.bind(
      transactionSemaphore,
    );
    const originalRelease = transactionSemaphore.release.bind(
      transactionSemaphore,
    );
    await originalAcquire();
    const clock = sinon.useFakeTimers();
    sinon.stub(transactionSemaphore, "acquire").callsFake(async (timeoutMs) => {
      evidence.semaphoreAcquireCount++;
      try {
        await originalAcquire(timeoutMs);
      } catch (error) {
        evidence.retryClassification.push("queue:wait-timeout");
        throw error;
      }
    });
    sinon.stub(transactionSemaphore, "release").callsFake(() => {
      evidence.semaphoreReleaseCount++;
      originalRelease();
    });
    const startSession = sinon.stub(mongoose, "startSession");

    const operation = captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async () => "must not run"),
        { semaphoreWaitTimeoutMs: 25 },
      ),
    );
    await clock.tickAsync(25);
    await operation;
    originalRelease();
    clock.restore();

    const queueTimeout = evidence.finalError;
    expect(queueTimeout).to.be.instanceOf(TransactionSemaphoreTimeoutError);
    expect(evidence).to.deep.equal({
      ...createEvidence(),
      semaphoreAcquireCount: 1,
      retryClassification: ["queue:wait-timeout"],
      finalOutcome: describeFinalError(queueTimeout),
      finalError: queueTimeout,
    });
    expect(startSession.called).to.equal(false);
    expect(unitOfWork.getMetrics().availablePermits).to.equal(1);
  });

  it("15. preserves the final transient body error at retry exhaustion", async () => {
    const evidence = createEvidence();
    const unitOfWork = createUnitOfWorkHarness(evidence);
    const errors = [1, 2, 3].map((attempt) =>
      createMongoError(
        `transient attempt ${attempt}`,
        112,
        "TransientTransactionError",
      ),
    );
    installSessionFactory(evidence);

    await captureOutcome(
      evidence,
      unitOfWork.executeInTransaction(
        instrumentBody(evidence, async (invocation) => {
          throw errors[invocation - 1];
        }),
        { maxBodyAttempts: 3, maxCommitAttempts: 7 },
      ),
    );

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      bodyInvocationCount: 3,
      abortInvocationCount: 3,
      sessionStartCount: 1,
      sessionEndCount: 1,
      semaphoreAcquireCount: 1,
      semaphoreReleaseCount: 1,
      backoffInvocationCount: 2,
      retryClassification: [
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
        "body:transient-transaction",
        "unit-of-work:retryable:transient-transaction",
      ],
      finalOutcome: describeFinalError(errors[2]),
      finalError: errors[2],
    });
  });

  it("18. controls backoff and full jitter without wall-clock delay", async () => {
    const evidence = createEvidence();
    const clock = sinon.useFakeTimers();
    sinon.stub(Math, "random").returns(0.5);
    let settled = false;

    const operation = backoffWithJitter(3, 100, 1_000).then(() => {
      settled = true;
      evidence.retryClassification.push("backoff:deterministic-full-jitter");
    });

    await clock.tickAsync(199);
    expect(settled).to.equal(false);
    await clock.tickAsync(1);
    await captureOutcome(evidence, operation);
    clock.restore();

    expect(evidence).to.deep.equal({
      ...createEvidence(),
      retryClassification: ["backoff:deterministic-full-jitter"],
      finalOutcome: { kind: "value", value: undefined },
    });
  });
});

describe("TransactionSemaphore bounded FIFO queue", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("times out and removes a queued waiter without changing permit count", async () => {
    const semaphore = new TransactionSemaphore(1);
    await semaphore.acquire();
    const clock = sinon.useFakeTimers();
    let finalError: unknown;

    const timedOut = semaphore.acquire(20).catch((error: unknown) => {
      finalError = error;
    });

    expect(semaphore.queueLength).to.equal(1);
    await clock.tickAsync(20);
    await timedOut;

    expect(finalError).to.be.instanceOf(TransactionSemaphoreTimeoutError);
    expect(semaphore.queueLength).to.equal(0);
    expect(semaphore.availablePermits).to.equal(0);

    semaphore.release();
    expect(semaphore.availablePermits).to.equal(1);
    expect(clock.countTimers()).to.equal(0);
    clock.restore();
  });

  it("resolves a same-tick release registered before the waiter timeout", async () => {
    const semaphore = new TransactionSemaphore(1);
    await semaphore.acquire();
    const clock = sinon.useFakeTimers();
    setTimeout(() => semaphore.release(), 10);

    const waiter = semaphore.acquire(10);
    await clock.tickAsync(10);
    await waiter;

    expect(semaphore.queueLength).to.equal(0);
    expect(semaphore.availablePermits).to.equal(0);
    expect(clock.countTimers()).to.equal(0);
    semaphore.release();
    expect(semaphore.availablePermits).to.equal(1);
    clock.restore();
  });

  it("does not leak a permit when the same-tick timeout is registered first", async () => {
    const semaphore = new TransactionSemaphore(1);
    await semaphore.acquire();
    const clock = sinon.useFakeTimers();
    let finalError: unknown;
    const waiter = semaphore.acquire(10).catch((error: unknown) => {
      finalError = error;
    });
    setTimeout(() => semaphore.release(), 10);

    await clock.tickAsync(10);
    await waiter;

    expect(finalError).to.be.instanceOf(TransactionSemaphoreTimeoutError);
    expect(semaphore.queueLength).to.equal(0);
    expect(semaphore.availablePermits).to.equal(1);
    expect(clock.countTimers()).to.equal(0);
    clock.restore();
  });

  it("does not let a timed-out waiter steal a later permit", async () => {
    const semaphore = new TransactionSemaphore(1);
    await semaphore.acquire();
    const clock = sinon.useFakeTimers();
    let timedOutError: unknown;
    let laterAcquired = false;

    const timedOut = semaphore.acquire(10).catch((error: unknown) => {
      timedOutError = error;
    });
    const later = semaphore.acquire(100).then(() => {
      laterAcquired = true;
    });

    await clock.tickAsync(10);
    await timedOut;
    expect(timedOutError).to.be.instanceOf(TransactionSemaphoreTimeoutError);
    expect(laterAcquired).to.equal(false);
    expect(semaphore.queueLength).to.equal(1);

    semaphore.release();
    await later;
    expect(laterAcquired).to.equal(true);
    expect(semaphore.availablePermits).to.equal(0);
    expect(semaphore.queueLength).to.equal(0);

    semaphore.release();
    expect(semaphore.availablePermits).to.equal(1);
    expect(clock.countTimers()).to.equal(0);
    clock.restore();
  });

  it("preserves FIFO order when a middle waiter times out", async () => {
    const semaphore = new TransactionSemaphore(1);
    await semaphore.acquire();
    const clock = sinon.useFakeTimers();
    const order: string[] = [];

    const first = semaphore.acquire(100).then(() => order.push("first"));
    const middle = semaphore.acquire(10).then(
      () => order.push("middle"),
      (error: unknown) => {
        expect(error).to.be.instanceOf(TransactionSemaphoreTimeoutError);
        order.push("middle-timeout");
      },
    );
    const third = semaphore.acquire(100).then(() => order.push("third"));

    await clock.tickAsync(10);
    await middle;
    expect(order).to.deep.equal(["middle-timeout"]);
    expect(semaphore.queueLength).to.equal(2);

    semaphore.release();
    await first;
    semaphore.release();
    await third;
    expect(order).to.deep.equal(["middle-timeout", "first", "third"]);

    semaphore.release();
    expect(semaphore.availablePermits).to.equal(1);
    expect(clock.countTimers()).to.equal(0);
    clock.restore();
  });

  it("preserves FIFO order when the leading waiter times out", async () => {
    const semaphore = new TransactionSemaphore(1);
    await semaphore.acquire();
    const clock = sinon.useFakeTimers();
    const order: string[] = [];

    const leading = semaphore.acquire(10).then(
      () => order.push("leading"),
      (error: unknown) => {
        expect(error).to.be.instanceOf(TransactionSemaphoreTimeoutError);
        order.push("leading-timeout");
      },
    );
    const second = semaphore.acquire(100).then(() => order.push("second"));
    const third = semaphore.acquire(100).then(() => order.push("third"));

    await clock.tickAsync(10);
    await leading;
    expect(order).to.deep.equal(["leading-timeout"]);

    semaphore.release();
    await second;
    semaphore.release();
    await third;
    expect(order).to.deep.equal(["leading-timeout", "second", "third"]);

    semaphore.release();
    expect(semaphore.availablePermits).to.equal(1);
    expect(semaphore.queueLength).to.equal(0);
    expect(clock.countTimers()).to.equal(0);
    clock.restore();
  });
});
