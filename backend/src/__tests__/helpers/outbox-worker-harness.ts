import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { z } from "zod";
import { EventBus } from "@/application/common/buses/event.bus";
import { MetricsService } from "@/metrics/metrics.service";
import { OutboxRepository } from "@/repositories/outbox.repository";
import type { IOutboxEvent } from "@/models/outbox.model";
import { TestableOutboxWorker, restoreEnv } from "./outbox-fixtures";

export interface OutboxWorkerHarness {
  eventBus: sinon.SinonStubbedInstance<EventBus>;
  outboxRepository: sinon.SinonStubbedInstance<OutboxRepository>;
  metricsService: sinon.SinonStubbedInstance<MetricsService>;
  outboxWorker: TestableOutboxWorker;
  random: sinon.SinonStub<[], number>;
  sandbox: sinon.SinonSandbox;
  arrangeClaims: (...outcomes: IOutboxEvent[][]) => void;
  assertClaims: (count: number) => string;
  cleanup: () => Promise<void>;
}

export const terminalLogSchema = z.object({
  event: z.string().optional(),
  message: z.string(),
  breadcrumbs: z.array(
    z.object({ event: z.string(), offsetMs: z.number().optional() }),
  ),
  error: z
    .object({
      name: z.string(),
      errors: z.array(z.object({ message: z.string() })).optional(),
      cause: z.object({ message: z.string() }).optional(),
    })
    .optional(),
});

export function logArguments(call: sinon.SinonSpyCall): unknown[] {
  return call.args;
}

export function createOutboxWorkerHarness(): OutboxWorkerHarness {
  const originalBaseDelay = process.env.OUTBOX_RETRY_BASE_DELAY_MS;
  const originalMaxDelay = process.env.OUTBOX_RETRY_MAX_DELAY_MS;
  const originalClaimTimeout = process.env.OUTBOX_CLAIM_TIMEOUT_MS;
  const sandbox = sinon.createSandbox();
  sandbox.useFakeTimers({
    now: Date.parse("2026-07-30T12:00:00.000Z"),
    toFake: ["Date", "setInterval", "clearInterval"],
  });
  const random = sandbox.stub(Math, "random").returns(0.5);
  process.env.OUTBOX_RETRY_BASE_DELAY_MS = "15000";
  process.env.OUTBOX_RETRY_MAX_DELAY_MS = "300000";
  process.env.OUTBOX_CLAIM_TIMEOUT_MS = "60000";

  const outboxRepository = sandbox.createStubInstance(OutboxRepository);
  outboxRepository.getBacklogStats.resolves({
    pendingCount: 1,
    exhaustedCount: 0,
  });
  outboxRepository.claimPendingEvents.resolves([]);
  outboxRepository.markHandlerProcessed.resolves(true);
  outboxRepository.markAsProcessed.resolves(true);
  outboxRepository.markAsFailed.resolves(true);
  outboxRepository.renewClaim.resolves(true);
  const metricsService = sandbox.createStubInstance(MetricsService);
  const eventBus = sandbox.createStubInstance(EventBus);
  const outboxWorker = new TestableOutboxWorker(
    outboxRepository,
    eventBus,
    metricsService,
  );
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function arrangeClaims(...outcomes: IOutboxEvent[][]): void {
    const offset = outboxRepository.claimPendingEvents.callCount;
    outcomes.forEach((outcome, index) => {
      outboxRepository.claimPendingEvents
        .onCall(offset + index)
        .resolves(outcome);
    });
  }

  function assertClaims(count: number): string {
    sinon.assert.callCount(outboxRepository.claimPendingEvents, count);
    const [, workerId, staleClaimMs] =
      outboxRepository.claimPendingEvents.firstCall.args;
    expect(workerId).to.match(uuidPattern);
    for (const claim of outboxRepository.claimPendingEvents.getCalls()) {
      expect(claim.args).to.deep.equal([1, workerId, staleClaimMs]);
    }
    return workerId;
  }

  async function cleanup(): Promise<void> {
    await outboxWorker.stop();
    sandbox.restore();
    restoreEnv("OUTBOX_RETRY_BASE_DELAY_MS", originalBaseDelay);
    restoreEnv("OUTBOX_RETRY_MAX_DELAY_MS", originalMaxDelay);
    restoreEnv("OUTBOX_CLAIM_TIMEOUT_MS", originalClaimTimeout);
  }

  return {
    eventBus,
    outboxRepository,
    metricsService,
    outboxWorker,
    random,
    sandbox,
    arrangeClaims,
    assertClaims,
    cleanup,
  };
}
