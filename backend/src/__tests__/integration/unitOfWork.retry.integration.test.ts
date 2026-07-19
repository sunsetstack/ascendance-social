import "reflect-metadata";
import { after, afterEach, before, beforeEach, describe, it } from "mocha";
import { expect } from "chai";
import sinon from "sinon";
import mongoose, { ClientSession, Types } from "mongoose";
import { UnitOfWork } from "@/database/UnitOfWork";
import { getErrorLabels } from "@/utils/errors";

const uri = process.env.INTEGRATION_MONGODB_URI;
const collectionName = "unit_of_work_retry_faults";

interface IntegrationEvidence {
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
  finalValue: unknown;
  finalError: unknown;
}

function createEvidence(): IntegrationEvidence {
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
    finalValue: undefined,
    finalError: undefined,
  };
}

function classify(error: unknown): string {
  return getErrorLabels(error)?.includes("TransientTransactionError")
    ? "transient-transaction"
    : "definite";
}

function instrumentUnitOfWork(
  unitOfWork: UnitOfWork,
  evidence: IntegrationEvidence,
): void {
  const originalStartSession = mongoose.startSession.bind(mongoose);
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
    .stub(
      unitOfWork as unknown as {
        isRetryableError(error: unknown): boolean;
      },
      "isRetryableError",
    )
    .callsFake((error: unknown) => {
      const retryable = originalClassifier(error);
      evidence.retryClassification.push(
        `unit-of-work:${retryable ? "retryable" : "non-retryable"}:${classify(error)}`,
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
  sinon.stub(mongoose, "startSession").callsFake(async () => {
    evidence.sessionStartCount++;
    const session = await originalStartSession();
    const originalCommit = session.commitTransaction.bind(session);
    const originalAbort = session.abortTransaction.bind(session);
    const originalEnd = session.endSession.bind(session);

    sinon
      .stub(session, "commitTransaction")
      .callsFake(async (...args: unknown[]) => {
        evidence.commitInvocationCount++;
        await (originalCommit as (...options: unknown[]) => Promise<void>)(
          ...args,
        );
      });
    sinon
      .stub(session, "abortTransaction")
      .callsFake(async (...args: unknown[]) => {
        evidence.abortInvocationCount++;
        await (originalAbort as (...options: unknown[]) => Promise<void>)(
          ...args,
        );
      });
    sinon.stub(session, "endSession").callsFake(async (...args: unknown[]) => {
      evidence.sessionEndCount++;
      await (originalEnd as (...options: unknown[]) => Promise<void>)(...args);
    });

    return session;
  });
}

describe("UnitOfWork retry integration", () => {
  let connectedHere = false;

  before(async () => {
    if (!uri) {
      throw new Error(
        "INTEGRATION_MONGODB_URI is required. Run `npm run test-integration` from the repository root to start the test replica set.",
      );
    }
    if (mongoose.connection.readyState === 0) {
      connectedHere = true;
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS: 5_000,
          connectTimeoutMS: 5_000,
        });
      } catch (error) {
        await mongoose.disconnect().catch(() => undefined);
        throw error;
      }
    }

    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    expect(hello.setName).to.equal("rs0");
  });

  beforeEach(async () => {
    await mongoose.connection.db!.collection(collectionName).deleteMany({});
  });

  afterEach(async () => {
    sinon.restore();
    await mongoose.connection.db!.collection(collectionName).deleteMany({});
  });

  after(async () => {
    if (connectedHere) await mongoose.disconnect();
  });

  it("8. rolls back transactional writes when the body fails", async () => {
    const unitOfWork = new UnitOfWork();
    const documentId = new Types.ObjectId();
    const bodyFailure = new Error("fail after transactional insert");
    const evidence = createEvidence();
    instrumentUnitOfWork(unitOfWork, evidence);

    try {
      evidence.finalValue = await unitOfWork.executeInTransaction(
        async (session: ClientSession) => {
          evidence.bodyInvocationCount++;
          try {
            await mongoose.connection.db!.collection(collectionName).insertOne(
              { _id: documentId, value: "must roll back" },
              { session },
            );
            evidence.transactionalSideEffectCount++;
            throw bodyFailure;
          } catch (error) {
            evidence.retryClassification.push("body:definite");
            throw error;
          }
        },
        { maxBodyAttempts: 1 },
      );
    } catch (error) {
      evidence.finalError = error;
    }

    const persisted = await mongoose.connection.db!
      .collection(collectionName)
      .findOne({ _id: documentId });

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
      transactionalSideEffectCount: 1,
      finalError: bodyFailure,
    });
    expect(persisted).to.equal(null);
  });

  it("retries a transient body safely without duplicating committed writes", async () => {
    const unitOfWork = new UnitOfWork();
    const documentId = new Types.ObjectId();
    const transient = new mongoose.mongo.MongoServerError({
      message: "injected transient body failure",
      code: 112,
    });
    transient.addErrorLabel("TransientTransactionError");
    const evidence = createEvidence();
    instrumentUnitOfWork(unitOfWork, evidence);

    try {
      evidence.finalValue = await unitOfWork.executeInTransaction(
        async (session: ClientSession) => {
          evidence.bodyInvocationCount++;
          try {
            await mongoose.connection.db!.collection(collectionName).insertOne(
              { _id: documentId, value: "one committed document" },
              { session },
            );
            evidence.transactionalSideEffectCount++;
            if (evidence.bodyInvocationCount === 1) throw transient;
            return "retried-commit";
          } catch (error) {
            evidence.retryClassification.push(
              `body:${classify(error)}`,
            );
            throw error;
          }
        },
        { maxBodyAttempts: 3, maxCommitAttempts: 3 },
      );
    } catch (error) {
      evidence.finalError = error;
    }

    const persisted = await mongoose.connection.db!
      .collection(collectionName)
      .find({ _id: documentId })
      .toArray();

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
      transactionalSideEffectCount: 2,
      finalValue: "retried-commit",
    });
    expect(persisted).to.have.length(1);
    expect(persisted[0]!.value).to.equal("one committed document");
  });
});
