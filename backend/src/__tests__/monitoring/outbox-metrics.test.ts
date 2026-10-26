import { expect } from "chai";
import { describe, it } from "mocha";
import { MetricsService } from "@/metrics/metrics.service";
import { TransactionMetricsTracker } from "@/database/transaction-metrics";
import { TransactionSemaphore } from "@/database/transaction-semaphore";

describe("outbox backlog metrics", () => {
  it("exports exhausted event count and oldest pending age", async () => {
    const metrics = new MetricsService();
    metrics.setOutboxBacklogStatus(2, new Date(Date.now() - 5_000));

    const output = await metrics.getMetrics();

    expect(output).to.match(
      /outbox_exhausted_events(?:\{[^}]*\})? 2(?:\r?\n|$)/,
    );
    expect(output).to.match(
      /outbox_oldest_pending_age_seconds(?:\{[^}]*\})? 5(?:\.\d+)?(?:\r?\n|$)/,
    );
  });

  it("exports confirmed transaction outcomes separately from staging and routing failures", async () => {
    const metrics = new MetricsService();
    const tracker = new TransactionMetricsTracker();
    const semaphore = new TransactionSemaphore(2);
    metrics.registerTransactionMetrics(() => tracker.observabilitySnapshot(semaphore));
    tracker.recordAttempt(); tracker.recordCommitAttempt(); tracker.recordRetry("commit");
    tracker.recordCommitAttempt(); tracker.recordAmbiguous(); tracker.recordDuration(250, 25);
    metrics.recordDomainEventStaged("TestEvent");
    metrics.recordOutboxDeliveryIssue("TestEvent", "no_handlers");
    const output = await metrics.getMetrics();
    expect(output).to.match(/transactions_total\{[^\n]*outcome="ambiguous"[^\n]*\} 1/);
    expect(output).to.match(/transactions_total\{[^\n]*outcome="committed"[^\n]*\} 0/);
    expect(output).to.match(/transaction_retries_total\{[^\n]*phase="commit"[^\n]*\} 1/);
    expect(output).to.match(/domain_events_staged_total\{[^\n]*event_type="TestEvent"[^\n]*\} 1/);
    expect(output).to.match(/outbox_delivery_issues_total\{[^\n]*reason="no_handlers"[^\n]*\} 1/);
    expect(await metrics.getMetrics()).to.equal(output);
  });
});
