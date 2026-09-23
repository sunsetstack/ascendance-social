import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import {
  ClientClosedError,
  SocketClosedUnexpectedlyError,
} from "redis";
import { getRequestContext } from "@/runtime/request-context";
import { errorLogger, logger } from "@/utils/winston";
import { FeedFanoutService } from "@/services/feed/feed-fanout.service";
import { NewFeedWarmCacheWorker } from "@/workers/_impl/newFeedWarmCache.worker.impl";
import { ProfileSyncWorker } from "@/workers/_impl/profile-sync.worker.impl";
import { createTrendingWorker } from "./trending-worker.test-helper";

type RootWorker = {
  runBackgroundRoot: (
    operation: string,
    work: () => Promise<void>,
  ) => Promise<void>;
};

function createWorkerMetrics() {
  return {
    markWorkerRunning: sinon.stub(),
    markWorkerStopped: sinon.stub(),
    markWorkerCrashed: sinon.stub(),
  };
}

function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function captureOverlappingRoots(
  worker: RootWorker,
): Promise<
  Array<{ correlationId?: string; breadcrumbs: readonly { event: string }[] }>
> {
  const contexts: Array<{
    correlationId?: string;
    breadcrumbs: readonly { event: string }[];
  }> = [];
  let releaseFirst: (() => void) | undefined;
  const first = worker.runBackgroundRoot("first_callback", async () => {
    const context = getRequestContext();
    contexts.push({
      correlationId: context?.correlationId,
      breadcrumbs: [...(context?.breadcrumbs ?? [])],
    });
    await new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
  });
  const second = worker.runBackgroundRoot("second_callback", async () => {
    const context = getRequestContext();
    contexts.push({
      correlationId: context?.correlationId,
      breadcrumbs: [...(context?.breadcrumbs ?? [])],
    });
  });

  await Promise.resolve();
  await second;
  releaseFirst?.();
  await first;
  return contexts;
}

function expectFreshContexts(
  contexts: Array<{
    correlationId?: string;
    breadcrumbs: readonly { event: string }[];
  }>,
  event: string,
): void {
  expect(contexts).to.have.length(2);
  expect(contexts[0]?.correlationId)
    .to.be.a("string")
    .and.not.equal(contexts[1]?.correlationId);
  expect(contexts[0]?.breadcrumbs.map(({ event: name }) => name)).to.deep.equal(
    [event],
  );
  expect(contexts[1]?.breadcrumbs.map(({ event: name }) => name)).to.deep.equal(
    [event],
  );
}

describe("background worker request-context roots", () => {
  afterEach(() => sinon.restore());

  it("isolates trending callback contexts and terminally logs unrelated failures that complete during shutdown", async () => {
    const worker = createTrendingWorker(
      {} as any,
      {
        updateTrendingScore: sinon
          .stub()
          .rejects(new Error("Redis write failed")),
        setWithTags: sinon.stub().resolves(),
        ackStreamMessages: sinon.stub().resolves(1),
      } as any,
      {
        findPostsByPublicIds: sinon.stub().resolves([
          {
            publicId: "post-1",
            likes: 1,
            commentsCount: 0,
            viewsCount: 0,
            createdAt: new Date(),
          },
        ]),
      } as any,
    );
    (worker as any).running = true;

    expectFreshContexts(
      await captureOverlappingRoots(worker as unknown as RootWorker),
      "worker.trending.callback.started",
    );

    const terminal = sinon.stub(errorLogger, "error");
    const unrelated = new Error("unrelated Redis write failure");
    let releaseFailure: (() => void) | undefined;
    const callback = (worker as any).runBackgroundRoot(
      "flush_pending",
      async () => {
        await new Promise<void>((resolve) => {
          releaseFailure = resolve;
        });
        throw unrelated;
      },
    );
    await Promise.resolve();
    (worker as any).stopping = true;
    releaseFailure?.();
    await callback;

    sinon.assert.calledOnce(terminal);
    const terminalRecord = terminal.firstCall.args[0] as any;
    expect(terminalRecord.worker).to.equal("TrendingWorker");
    expect(terminalRecord.operation).to.equal("worker.trending.flush_pending");
    expect(terminalRecord.error.message).to.equal(unrelated.message);

    terminal.resetHistory();
    (worker as any).stopping = false;
    let releaseClosedClient: (() => void) | undefined;
    const expectedShutdown = (worker as any).runBackgroundRoot(
      "read_loop_iteration",
      async () => {
        await new Promise<void>((resolve) => {
          releaseClosedClient = resolve;
        });
        throw new ClientClosedError();
      },
    );
    await Promise.resolve();
    (worker as any).stopping = true;
    releaseClosedClient?.();
    await expectedShutdown;
    sinon.assert.notCalled(terminal);

    (worker as any).stopping = false;
    const warning = sinon.stub(logger, "warn");
    await (worker as any).handleStreamMessage("1-0", { postId: "post-1" });
    await (worker as any).flushPending();
    sinon.assert.calledOnce(warning);
    sinon.assert.notCalled(terminal);
  });

  it("warns and retries a retryable Trending read failure", async () => {
    const xReadGroup = sinon.stub();
    xReadGroup.onFirstCall().rejects(new SocketClosedUnexpectedlyError());
    xReadGroup.onSecondCall().resolves(null);
    const worker = createTrendingWorker({} as any, {} as any, {} as any);
    (worker as any).redisClient = { xReadGroup };
    sinon.stub(worker as any, "sleep").resolves();
    const warning = sinon.stub(logger, "warn");
    const terminal = sinon.stub(errorLogger, "error");

    await (worker as any).readLoopIteration();
    await (worker as any).readLoopIteration();

    sinon.assert.calledTwice(xReadGroup);
    sinon.assert.calledOnce(warning);
    sinon.assert.calledWithExactly((worker as any).sleep, 1000);
    sinon.assert.notCalled(terminal);
  });

  it("owns one unexpected Trending read-loop failure and transitions it to crashed", async () => {
    const clock = sinon.useFakeTimers();
    try {
      const failure = new Error("unexpected iteration failure");
      const metrics = createWorkerMetrics();
      const quit = sinon.stub().resolves();
      const redisClient = { isOpen: true, quit };
      const worker = createTrendingWorker(
        {} as any,
        {} as any,
        {} as any,
        metrics as any,
      );
      (worker as any).redisClient = redisClient;
      const iteration = sinon
        .stub(worker as any, "readLoopIteration")
        .rejects(failure);
      sinon.stub(worker as any, "fullRefresh").resolves();
      const flushPending = sinon
        .stub(worker as any, "flushPending")
        .resolves();
      const terminal = sinon.stub(errorLogger, "error");

      worker.start();
      const readLoopTask = (worker as any).readLoopTask as Promise<unknown>;
      await readLoopTask;
      await Promise.resolve();

      sinon.assert.calledOnce(iteration);
      sinon.assert.calledOnce(terminal);
      const terminalRecord = terminal.firstCall.args[0] as any;
      expect(terminalRecord.operation).to.equal("worker.trending.read_loop");
      expect(terminalRecord.error.message).to.equal(failure.message);
      expect((worker as any).running).to.equal(false);
      expect((worker as any).stopping).to.equal(false);
      expect((worker as any).redisClient).to.equal(redisClient);
      expect((worker as any).readLoopTask).to.equal(undefined);
      expect((worker as any).flushTimer).to.equal(undefined);
      expect((worker as any).reclaimTimer).to.equal(undefined);
      expect((worker as any).fullRefreshTimer).to.equal(undefined);
      sinon.assert.calledWithExactly(
        metrics.markWorkerCrashed,
        "trending.worker",
      );
      sinon.assert.callOrder(
        metrics.markWorkerRunning,
        metrics.markWorkerCrashed,
      );
      sinon.assert.notCalled(metrics.markWorkerStopped);
      sinon.assert.notCalled(flushPending);
      sinon.assert.notCalled(quit);
    } finally {
      clock.restore();
    }
  });

  it("restarts one Trending generation without timer duplication or stale settlement", async () => {
    const clock = sinon.useFakeTimers();
    try {
      const metrics = createWorkerMetrics();
      const worker = createTrendingWorker(
        {} as any,
        {} as any,
        {} as any,
        metrics as any,
      );
      (worker as any).redisClient = { isOpen: false };
      const iteration = sinon
        .stub(worker as any, "readLoopIteration")
        .rejects(new Error("first generation failed"));
      const staleRefresh = createDeferred();
      let fullRefreshCalls = 0;
      const fullRefresh = sinon
        .stub(worker as any, "fullRefresh")
        .callsFake(() => {
          fullRefreshCalls += 1;
          return fullRefreshCalls === 1
            ? staleRefresh.promise
            : Promise.resolve();
        });
      sinon.stub(worker as any, "flushPending").resolves();
      sinon.stub(errorLogger, "error");

      worker.start();
      const oldTask = (worker as any).readLoopTask as Promise<unknown>;
      const oldGeneration = (worker as any).readLoopGeneration as number;
      await oldTask;
      await Promise.resolve();

      const activeIteration = createDeferred();
      iteration.resetHistory();
      iteration.resetBehavior();
      iteration.callsFake(() => activeIteration.promise);

      const restart = worker.start();
      await Promise.resolve();
      expect((worker as any).readLoopTask).to.equal(undefined);
      sinon.assert.calledOnce(fullRefresh);

      staleRefresh.resolve();
      await restart;
      const restartedTask = (worker as any).readLoopTask;
      const restartedTimers = [
        (worker as any).flushTimer,
        (worker as any).reclaimTimer,
        (worker as any).fullRefreshTimer,
      ];
      expect(restartedTimers).not.to.include(undefined);
      expect(new Set(restartedTimers).size).to.equal(3);
      worker.start();
      await Promise.resolve();

      expect((worker as any).readLoopTask).to.equal(restartedTask);
      expect([
        (worker as any).flushTimer,
        (worker as any).reclaimTimer,
        (worker as any).fullRefreshTimer,
      ]).to.deep.equal(restartedTimers);
      sinon.assert.calledOnce(iteration);
      sinon.assert.calledTwice(fullRefresh);
      sinon.assert.calledTwice(metrics.markWorkerRunning);

      (worker as any).settleReadLoopTask(oldTask, oldGeneration, {
        kind: "stopped",
      });
      expect((worker as any).readLoopTask).to.equal(restartedTask);
      expect((worker as any).running).to.equal(true);
      expect([
        (worker as any).flushTimer,
        (worker as any).reclaimTimer,
        (worker as any).fullRefreshTimer,
      ]).to.deep.equal(restartedTimers);

      const stopTask = worker.stop();
      await Promise.resolve();
      activeIteration.resolve();
      await stopTask;
      expect((worker as any).flushTimer).to.equal(undefined);
      expect((worker as any).reclaimTimer).to.equal(undefined);
      expect((worker as any).fullRefreshTimer).to.equal(undefined);
    } finally {
      clock.restore();
    }
  });

  it("owns Trending request-context setup failures without an unhandled rejection", async () => {
    const failure = new Error("request context setup failed");
    const metrics = createWorkerMetrics();
    const worker = createTrendingWorker(
      {} as any,
      {} as any,
      {} as any,
      metrics as any,
    );
    (worker as any).redisClient = {};
    sinon
      .stub(worker as any, "runReadLoopInContext")
      .throws(failure);
    sinon.stub(worker as any, "fullRefresh").resolves();
    const terminal = sinon.stub(errorLogger, "error");
    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", captureUnhandled);

    try {
      worker.start();
      const readLoopTask = (worker as any).readLoopTask as Promise<unknown>;
      await readLoopTask;
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(unhandled).to.deep.equal([]);
      sinon.assert.calledOnce(terminal);
      expect((terminal.firstCall.args[0] as any).error.message).to.equal(
        failure.message,
      );
      expect((worker as any).running).to.equal(false);
      expect((worker as any).readLoopTask).to.equal(undefined);
    } finally {
      process.off("unhandledRejection", captureUnhandled);
    }
  });

  it("waits for the active Trending read loop during ordinary shutdown", async () => {
    const clock = sinon.useFakeTimers();
    try {
      const metrics = createWorkerMetrics();
      const quit = sinon.stub().resolves();
      const worker = createTrendingWorker(
        {} as any,
        {} as any,
        {} as any,
        metrics as any,
      );
      (worker as any).redisClient = { isOpen: true, quit };
      const activeIteration = createDeferred();
      sinon
        .stub(worker as any, "readLoopIteration")
        .callsFake(() => activeIteration.promise);
      sinon.stub(worker as any, "fullRefresh").resolves();
      const flushPending = sinon
        .stub(worker as any, "flushPending")
        .resolves();
      const terminal = sinon.stub(errorLogger, "error");

      worker.start();
      let stopResolved = false;
      const stopTask = worker.stop().then(() => {
        stopResolved = true;
      });
      await Promise.resolve();

      expect(stopResolved).to.equal(false);
      expect((worker as any).running).to.equal(false);
      expect((worker as any).stopping).to.equal(true);
      expect((worker as any).flushTimer).to.equal(undefined);
      expect((worker as any).reclaimTimer).to.equal(undefined);
      expect((worker as any).fullRefreshTimer).to.equal(undefined);
      sinon.assert.notCalled(flushPending);
      sinon.assert.notCalled(quit);
      sinon.assert.calledWithExactly(
        metrics.markWorkerStopped,
        "trending.worker",
      );

      activeIteration.resolve();
      await stopTask;

      expect((worker as any).readLoopTask).to.equal(undefined);
      expect((worker as any).redisClient).to.equal(null);
      sinon.assert.calledOnce(flushPending);
      sinon.assert.calledOnce(quit);
      sinon.assert.calledOnce(metrics.markWorkerStopped);
      sinon.assert.notCalled(metrics.markWorkerCrashed);
      sinon.assert.notCalled(terminal);
    } finally {
      clock.restore();
    }
  });

  it("gives a malformed Trending read response one terminal owner", async () => {
    const worker = createTrendingWorker({} as any, {} as any, {} as any);
    (worker as any).redisClient = {
      xReadGroup: sinon.stub().resolves([{ messages: null }]),
    };
    const warning = sinon.stub(logger, "warn");
    const terminal = sinon.stub(errorLogger, "error");

    await (worker as any).runBackgroundRoot("read_loop_iteration", () =>
      (worker as any).readLoopIteration(),
    );

    sinon.assert.notCalled(warning);
    sinon.assert.calledOnce(terminal);
    const terminalRecord = terminal.firstCall.args[0] as any;
    expect(terminalRecord.operation).to.equal(
      "worker.trending.read_loop_iteration",
    );
    expect(terminalRecord.error.message).to.equal(
      "Malformed Redis stream response",
    );

    terminal.resetHistory();
    (worker as any).redisClient.xReadGroup = sinon
      .stub()
      .rejects(new Error("unexpected Redis failure"));
    await (worker as any).runBackgroundRoot("read_loop_iteration", () =>
      (worker as any).readLoopIteration(),
    );
    sinon.assert.calledOnce(terminal);
    expect((terminal.firstCall.args[0] as any).error.message).to.equal(
      "unexpected Redis failure",
    );
  });

  it("requeues recoverable Trending flush reads and writes without acknowledging", async () => {
    const repositoryFailure = new Error("repository unavailable");
    const repositoryAckStreamMessages = sinon.stub().resolves(1);
    const repositoryWorker = createTrendingWorker(
      {} as any,
      {
        updateTrendingScore: sinon.stub().resolves(),
        setWithTags: sinon.stub().resolves(),
        ackStreamMessages: repositoryAckStreamMessages,
      } as any,
      {
        findPostsByPublicIds: sinon.stub().rejects(repositoryFailure),
      } as any,
    );
    (repositoryWorker as any).pending.set("post-1", {
      commentsDelta: 0,
      likesDelta: 0,
      lastSeen: 1,
      messageIds: ["1-0"],
    });
    const warning = sinon.stub(logger, "warn");
    const terminal = sinon.stub(errorLogger, "error");

    await (repositoryWorker as any).flushPending();

    expect(
      (repositoryWorker as any).pending.get("post-1").messageIds,
    ).to.deep.equal(["1-0"]);
    sinon.assert.calledOnce(warning);
    sinon.assert.notCalled(repositoryAckStreamMessages);
    sinon.assert.notCalled(terminal);

    warning.resetHistory();
    const redisFailure = new Error("Redis unavailable");
    const redisAckStreamMessages = sinon.stub().resolves(1);
    const redisWorker = createTrendingWorker(
      {} as any,
      {
        updateTrendingScore: sinon.stub().rejects(redisFailure),
        setWithTags: sinon.stub().resolves(),
        ackStreamMessages: redisAckStreamMessages,
      } as any,
      {
        findPostsByPublicIds: sinon.stub().resolves([
          {
            publicId: "post-2",
            likes: 1,
            commentsCount: 0,
            viewsCount: 0,
            createdAt: new Date(),
          },
        ]),
      } as any,
    );
    (redisWorker as any).pending.set("post-2", {
      commentsDelta: 0,
      likesDelta: 0,
      lastSeen: 1,
      messageIds: ["2-0"],
    });

    await (redisWorker as any).flushPending();

    expect((redisWorker as any).pending.get("post-2").messageIds).to.deep.equal(
      ["2-0"],
    );
    sinon.assert.calledOnce(warning);
    sinon.assert.notCalled(redisAckStreamMessages);
    sinon.assert.notCalled(terminal);
  });

  it("gives structural Trending flush failures one terminal owner", async () => {
    const worker = createTrendingWorker(
      {} as any,
      {
        updateTrendingScore: sinon.stub().resolves(),
        setWithTags: sinon.stub().resolves(),
        ackStreamMessages: sinon.stub().resolves(1),
      } as any,
      {
        findPostsByPublicIds: sinon.stub().resolves({ malformed: true }),
      } as any,
    );
    (worker as any).pending.set("post-1", {
      commentsDelta: 0,
      likesDelta: 0,
      lastSeen: 1,
      messageIds: ["1-0"],
    });
    const warning = sinon.stub(logger, "warn");
    const terminal = sinon.stub(errorLogger, "error");

    await (worker as any).runBackgroundRoot("flush_pending", () =>
      (worker as any).flushPending(),
    );

    sinon.assert.notCalled(warning);
    sinon.assert.calledOnce(terminal);
    expect((terminal.firstCall.args[0] as any).error.message).to.equal(
      "Malformed repository result during trending flush",
    );
    expect((worker as any).pending.get("post-1").messageIds).to.deep.equal([
      "1-0",
    ]);
  });

  it("gives malformed reclaim and full-refresh data one terminal owner each", async () => {
    const terminal = sinon.stub(errorLogger, "error");
    const warning = sinon.stub(logger, "warn");
    const reclaimWorker = createTrendingWorker(
      {} as any,
      {
        xPendingRange: sinon.stub().resolves({ malformed: true }),
      } as any,
      {} as any,
    );

    await (reclaimWorker as any).runBackgroundRoot(
      "reclaim_stalled_messages",
      () => (reclaimWorker as any).reclaimStalledMessages(),
    );

    sinon.assert.notCalled(warning);
    sinon.assert.calledOnce(terminal);
    expect((terminal.firstCall.args[0] as any).error.message).to.equal(
      "Malformed XPENDING response",
    );

    terminal.resetHistory();
    const refreshWorker = createTrendingWorker(
      {
        getTrendingFeedWithCursor: sinon
          .stub()
          .resolves({ data: { malformed: true } }),
      } as any,
      {} as any,
      {} as any,
    );

    await (refreshWorker as any).runBackgroundRoot("full_refresh", () =>
      (refreshWorker as any).fullRefresh(),
    );

    sinon.assert.notCalled(warning);
    sinon.assert.calledOnce(terminal);
    expect((terminal.firstCall.args[0] as any).error.message).to.equal(
      "Malformed trending full-refresh result",
    );
  });

  it("gives unexpected profile message-handler failures one terminal owner and retains failed snapshots", async () => {
    let messageCallback:
      | ((channel: string, message: Record<string, unknown>) => void)
      | undefined;
    const subscribe = sinon.stub().callsFake(async (_channels, callback) => {
      messageCallback = callback;
      return true;
    });
    let resolveUpdateStarted: (() => void) | undefined;
    const updateStarted = new Promise<void>((resolve) => {
      resolveUpdateStarted = resolve;
    });
    let rejectFirstUpdate: ((error: Error) => void) | undefined;
    const updateAuthorSnapshot = sinon.stub().callsFake(() => {
      if (updateAuthorSnapshot.callCount === 1) {
        resolveUpdateStarted?.();
        return new Promise<void>((_resolve, reject) => {
          rejectFirstUpdate = reject;
        });
      }
      return Promise.resolve(1);
    });
    const worker = new ProfileSyncWorker(
      { subscribe } as any,
      { updateAuthorSnapshot } as any,
      {
        findByPublicId: sinon
          .stub()
          .resolves({ id: "507f1f77bcf86cd799439011" }),
      } as any,
    );
    await worker.start();

    expectFreshContexts(
      await captureOverlappingRoots(worker as unknown as RootWorker),
      "worker.profile_sync.callback.started",
    );

    const terminal = sinon.stub(errorLogger, "error");
    const messageFailure = new Error("message handler failure");
    sinon.stub(worker as any, "handleMessage").rejects(messageFailure);
    messageCallback?.("profile_snapshot_updates", {} as any);
    await Promise.resolve();
    await Promise.resolve();

    sinon.assert.calledOnce(terminal);
    const terminalRecord = terminal.firstCall.args[0] as any;
    expect(terminalRecord.worker).to.equal("ProfileSyncWorker");
    expect(terminalRecord.operation).to.equal(
      "worker.profile_sync.handle_message",
    );
    expect(terminalRecord.error.message).to.equal(messageFailure.message);

    terminal.resetHistory();
    (worker as any).handleMessage.restore();
    (worker as any).pendingUpdates.set("user-1", {
      avatarUrl: "older-avatar",
      username: "older-name",
      lastSeen: 1,
    });
    const firstFlush = (worker as any).flushPendingUpdates();
    await updateStarted;
    (worker as any).pendingUpdates.set("user-1", {
      avatarUrl: "newer-avatar",
      handle: "newer-handle",
      lastSeen: 2,
    });
    rejectFirstUpdate?.(new Error("Mongo unavailable"));
    await firstFlush;

    expect((worker as any).pendingUpdates.get("user-1")).to.deep.equal({
      avatarUrl: "newer-avatar",
      username: "older-name",
      handle: "newer-handle",
      lastSeen: 2,
    });
    await (worker as any).flushPendingUpdates();
    expect(updateAuthorSnapshot.callCount).to.equal(2);
    expect((worker as any).pendingUpdates.size).to.equal(0);
    sinon.assert.notCalled(terminal);
    await worker.stop();
  });

  it("keeps profile and trending callbacks in flight until their final shutdown flush completes", async () => {
    let profileCallback:
      | ((channel: string, message: Record<string, unknown>) => void)
      | undefined;
    const profileSubscribe = sinon
      .stub()
      .callsFake(async (_channels, callback) => {
        profileCallback = callback;
        return true;
      });
    const profile = new ProfileSyncWorker(
      { subscribe: profileSubscribe } as any,
      {} as any,
      {} as any,
    );
    const profileFlush = sinon
      .stub(profile as any, "flushPendingUpdates")
      .resolves();
    let releaseProfileMessage: (() => void) | undefined;
    let resolveProfileMessageStarted: (() => void) | undefined;
    const profileMessageStarted = new Promise<void>((resolve) => {
      resolveProfileMessageStarted = resolve;
    });
    sinon.stub(profile as any, "handleMessage").callsFake(async () => {
      resolveProfileMessageStarted?.();
      await new Promise<void>((resolve) => {
        releaseProfileMessage = resolve;
      });
    });
    await profile.start();
    profileCallback?.("profile_snapshot_updates", {} as any);
    await profileMessageStarted;

    const profileStop = profile.stop();
    await Promise.resolve();
    sinon.assert.notCalled(profileFlush);
    releaseProfileMessage?.();
    await profileStop;
    sinon.assert.calledOnce(profileFlush);
    profileCallback?.("profile_snapshot_updates", {} as any);
    await Promise.resolve();
    await Promise.resolve();
    sinon.assert.calledOnce((profile as any).handleMessage);

    const trending = createTrendingWorker({} as any, {} as any, {} as any);
    (trending as any).running = true;
    (trending as any).redisClient = {
      xReadGroup: sinon
        .stub()
        .resolves([
          { messages: [{ id: "1-0", message: { postId: "post-1" } }] },
        ]),
    };
    const trendingFlush = sinon
      .stub(trending as any, "flushPending")
      .resolves();
    let releaseTrendingMessage: (() => void) | undefined;
    let resolveTrendingMessageStarted: (() => void) | undefined;
    const trendingMessageStarted = new Promise<void>((resolve) => {
      resolveTrendingMessageStarted = resolve;
    });
    sinon.stub(trending as any, "handleStreamMessage").callsFake(async () => {
      resolveTrendingMessageStarted?.();
      await new Promise<void>((resolve) => {
        releaseTrendingMessage = resolve;
      });
    });
    await (trending as any).readLoopIteration();
    await trendingMessageStarted;

    const trendingStop = trending.stop();
    await Promise.resolve();
    sinon.assert.notCalled(trendingFlush);
    releaseTrendingMessage?.();
    await trendingStop;
    sinon.assert.calledOnce(trendingFlush);
    (trending as any).redisClient = {
      xReadGroup: sinon
        .stub()
        .resolves([
          { messages: [{ id: "2-0", message: { postId: "post-2" } }] },
        ]),
    };
    await (trending as any).readLoopIteration();
    await Promise.resolve();
    expect((trending as any).handleStreamMessage.callCount).to.equal(1);
  });

  it("gives failed NewFeed prewarms one terminal owner without a success log", async () => {
    const prewarmFailure = new Error("Redis unavailable");
    const prewarmNewFeed = sinon.stub().rejects(prewarmFailure);
    const worker = new NewFeedWarmCacheWorker({ prewarmNewFeed } as any);

    expectFreshContexts(
      await captureOverlappingRoots(worker as unknown as RootWorker),
      "worker.new_feed_warm_cache.callback.started",
    );

    const terminal = sinon.stub(errorLogger, "error");
    const info = sinon.stub(logger, "info");
    const warning = sinon.stub(logger, "warn");

    await (worker as any).admitRefresh("scheduled_cache_refresh");

    sinon.assert.calledOnce(terminal);
    sinon.assert.notCalled(warning);
    expect(
      info
        .getCalls()
        .some(
          ({ args }) =>
            (args[0] as unknown) ===
            "New feed warm cache worker completed successfully",
        ),
    ).to.equal(false);
    const terminalRecord = terminal.firstCall.args[0] as any;
    expect(terminalRecord.operation).to.equal(
      "worker.new_feed_warm_cache.scheduled_cache_refresh",
    );
    expect(terminalRecord.error.message).to.equal(prewarmFailure.message);
  });

  it("propagates original FeedFanout DAO and cache failures without local logging", async () => {
    const queryFailure = new Error("feed query failed");
    const queryService = new FeedFanoutService(
      {
        getNewFeedWithCursor: sinon.stub().rejects(queryFailure),
      } as any,
      {} as any,
      {
        setWithTags: sinon.stub().resolves(),
      } as any,
    );
    const serviceError = sinon.stub(logger, "error");
    let caught: unknown;

    try {
      await queryService.prewarmNewFeed();
    } catch (error) {
      caught = error;
    }

    expect(caught).to.equal(queryFailure);

    const cacheFailure = new Error("cache write failed");
    const cacheService = new FeedFanoutService(
      {
        getNewFeedWithCursor: sinon.stub().resolves({
          data: [],
          hasMore: false,
          nextCursor: undefined,
          prevCursor: undefined,
        }),
      } as any,
      {} as any,
      {
        setWithTags: sinon.stub().rejects(cacheFailure),
      } as any,
    );
    caught = undefined;
    try {
      await cacheService.prewarmNewFeed();
    } catch (error) {
      caught = error;
    }

    expect(caught).to.equal(cacheFailure);
    sinon.assert.notCalled(serviceError);
  });

  it("waits for admitted NewFeed refreshes and prevents stop-start overlap", async () => {
    let activeRefreshes = 0;
    let maxActiveRefreshes = 0;
    let releaseFirstRefresh: (() => void) | undefined;
    let resolveFirstRefreshStarted: (() => void) | undefined;
    const firstRefreshStarted = new Promise<void>((resolve) => {
      resolveFirstRefreshStarted = resolve;
    });
    const prewarmNewFeed = sinon.stub().callsFake(async () => {
      activeRefreshes += 1;
      maxActiveRefreshes = Math.max(maxActiveRefreshes, activeRefreshes);
      try {
        if (prewarmNewFeed.callCount === 1) {
          resolveFirstRefreshStarted?.();
          await new Promise<void>((resolve) => {
            releaseFirstRefresh = resolve;
          });
        }
      } finally {
        activeRefreshes -= 1;
      }
    });
    const worker = new NewFeedWarmCacheWorker({ prewarmNewFeed } as any);
    let cronCallback: (() => void) | undefined;
    const stopCron = sinon.stub();
    const schedule = sinon.stub().callsFake((_expression, callback) => {
      cronCallback = callback as () => void;
      return { stop: stopCron } as any;
    });
    (worker as any).scheduleCron = schedule;

    const firstRefresh = (worker as any).admitRefresh("startup_cache_refresh");
    await firstRefreshStarted;

    let stopResolved = false;
    const stop = worker.stop().then(() => {
      stopResolved = true;
    });
    await Promise.resolve();
    expect(stopResolved).to.equal(false);

    worker.start();
    worker.start();
    sinon.assert.calledOnce(schedule);
    sinon.assert.calledWithExactly(schedule, "0 * * * *", sinon.match.func);
    cronCallback?.();
    await Promise.resolve();
    sinon.assert.calledOnce(prewarmNewFeed);

    releaseFirstRefresh?.();
    await firstRefresh;
    await stop;
    expect(stopResolved).to.equal(true);
    expect(maxActiveRefreshes).to.equal(1);

    cronCallback?.();
    await Promise.resolve();
    await Promise.resolve();
    sinon.assert.calledTwice(prewarmNewFeed);
    expect(maxActiveRefreshes).to.equal(1);

    await worker.stop();
    sinon.assert.calledOnce(stopCron);
  });

  it("preserves the existing interval cadence and overlap controls", async () => {
    const clock = sinon.useFakeTimers();
    try {
      const trending = createTrendingWorker({} as any, {} as any, {} as any);
      const readLoop = sinon
        .stub(trending as any, "readLoop")
        .resolves({ kind: "stopped" });
      const flushPending = sinon
        .stub(trending as any, "flushPending")
        .resolves();
      sinon.stub(trending as any, "reclaimStalledMessages").resolves();
      sinon.stub(trending as any, "fullRefresh").resolves();
      (trending as any).BATCH_WINDOW_MS = 2_000;
      trending.start();
      await clock.tickAsync(1_999);
      sinon.assert.notCalled(flushPending);
      await clock.tickAsync(1);
      sinon.assert.calledOnce(flushPending);
      sinon.assert.calledOnce(readLoop);
      await trending.stop();

      const subscribe = sinon.stub().resolves(true);
      const profile = new ProfileSyncWorker(
        { subscribe } as any,
        {} as any,
        {} as any,
      );
      const flushPendingUpdates = sinon
        .stub(profile as any, "flushPendingUpdates")
        .resolves();
      (profile as any).FLUSH_INTERVAL_MS = 2_000;
      await profile.start();
      await clock.tickAsync(1_999);
      sinon.assert.notCalled(flushPendingUpdates);
      await clock.tickAsync(1);
      sinon.assert.calledOnce(flushPendingUpdates);
      await profile.stop();
    } finally {
      clock.restore();
    }
  });
});
