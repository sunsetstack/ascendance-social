import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import type { Server as SocketIOServer } from "socket.io";
import { RealTimeFeedService, type FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { RedisService } from "@/services/redis.service";
import { WebSocketServer } from "@/server/socketServer";
import { MetricsService } from "@/metrics/metrics.service";
import { EventRegistry } from "@/application/common/events/event-registry";
import { logger } from "@/utils/winston";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe("RealTimeFeedService startup recovery", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let redis: sinon.SinonStubbedInstance<RedisService>;
  let sockets: sinon.SinonStubbedInstance<WebSocketServer>;
  let metrics: sinon.SinonStubbedInstance<MetricsService>;
  let service: RealTimeFeedService | undefined;
  let handle: sinon.SinonStub;
  let listeners: Array<(channel: string, message: unknown) => void>;
  const channels = [EventRegistry.redisChannels.feedUpdates, EventRegistry.redisChannels.messagingUpdates, EventRegistry.redisChannels.notificationUpdates];
  const message: FeedUpdateMessage = {
    type: EventRegistry.realtimeMessageTypes.newNotification,
    eventId: "startup-recovery-notification", timestamp: "2026-10-08T00:00:00.000Z",
  };

  function construct(): RealTimeFeedService {
    service = new RealTimeFeedService(redis, sockets, [{ messageType: message.type, handle }], metrics);
    return service;
  }

  function publish(): void {
    listeners.forEach((listener) => listener(EventRegistry.redisChannels.notificationUpdates, message));
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    sandbox.stub(logger, "info");
    sandbox.stub(logger, "warn");
    sandbox.stub(logger, "error");
    redis = sandbox.createStubInstance(RedisService);
    sockets = sandbox.createStubInstance(WebSocketServer);
    sockets.getIO.returns({} as SocketIOServer);
    metrics = sandbox.createStubInstance(MetricsService);
    handle = sandbox.stub().resolves();
    listeners = [];
    service = undefined;
    redis.subscribe.callsFake(async (requested, listener) => {
      expect(requested).to.deep.equal(channels);
      listeners.push(listener);
      return true;
    });
  });

  afterEach(() => {
    service?.stop();
    sandbox.restore();
  });

  for (const failure of ["false", "rejection"] as const) {
    it(`recovers delivery after the initial subscription ${failure} without reconstructing the service`, async () => {
      const initial = deferred<boolean>();
      redis.subscribe.onFirstCall().returns(initial.promise);
      const original = construct();
      sinon.assert.calledOnce(redis.subscribe);
      if (failure === "false") initial.resolve(false);
      else initial.reject(new Error("Redis temporarily unavailable"));
      await clock.tickAsync(0);
      publish();
      sinon.assert.notCalled(handle);
      expect(listeners).to.have.lengthOf(0);
      expect((logger.warn as sinon.SinonStub).called || (logger.error as sinon.SinonStub).called).to.equal(true);
      await clock.tickAsync(4999);
      sinon.assert.calledOnce(redis.subscribe);
      await clock.tickAsync(1);
      expect(redis.subscribe.callCount, "failed startup must retry once the subscription boundary recovers").to.equal(2);
      expect(service).to.equal(original);
      expect(listeners).to.have.lengthOf(1);
      sinon.assert.calledWith(logger.warn as sinon.SinonStub, "Real-time feed subscription retry scheduled",
        sinon.match({ event: "realtime_feed.subscription.retry_scheduled", delayMs: 5000 }));
      sinon.assert.calledWith(logger.info as sinon.SinonStub, "Real-time feed update listener initialized",
        sinon.match({ event: "realtime_feed.subscription.recovered", attempt: 2 }));
      publish();
      await clock.tickAsync(0);
      sinon.assert.calledOnceWithExactly(handle, sockets.getIO.firstCall.returnValue, message, EventRegistry.redisChannels.notificationUpdates);
      await clock.tickAsync(60_000);
      expect(redis.subscribe.callCount).to.equal(2);
      expect(listeners).to.have.lengthOf(1);
    });
  }

  it("subscribes once on normal startup and dispatches each publication once", async () => {
    construct();
    await clock.tickAsync(0);
    sinon.assert.calledOnce(redis.subscribe);
    expect(listeners).to.have.lengthOf(1);
    publish();
    await clock.tickAsync(60_000);
    sinon.assert.calledOnce(handle);
    sinon.assert.calledOnce(redis.subscribe);
  });

  it("does not start concurrent attempts and waits for a failed attempt to settle before retrying", async () => {
    const initial = deferred<boolean>();
    redis.subscribe.onFirstCall().returns(initial.promise);
    construct();
    await clock.tickAsync(60_000);
    sinon.assert.calledOnce(redis.subscribe);
    initial.resolve(false);
    await clock.tickAsync(0);
    await clock.tickAsync(4999);
    sinon.assert.calledOnce(redis.subscribe);
    await clock.tickAsync(1);
    expect(redis.subscribe.callCount).to.equal(2);
  });

  it("leaves the retry timer unreferenced and cancels it when stopped", async () => {
    const timeout = sandbox.spy(global, "setTimeout");
    redis.subscribe.onFirstCall().resolves(false);
    construct();
    await clock.tickAsync(0);
    expect(timeout.callCount).to.equal(1);
    expect((timeout.firstCall.returnValue as NodeJS.Timeout).hasRef()).to.equal(false);
    service!.stop();
    service!.stop();
    await clock.tickAsync(60_000);
    sinon.assert.calledOnce(redis.subscribe);
    expect(clock.countTimers()).to.equal(0);
  });

  for (const result of [false, true] as const) {
    it(`does not retry or dispatch after stop during an in-flight attempt that returns ${result}`, async () => {
      const initial = deferred<boolean>();
      redis.subscribe.onFirstCall().callsFake((_channels, listener) => {
        listeners.push(listener);
        return initial.promise;
      });
      construct();
      service!.stop();
      initial.resolve(result);
      await clock.tickAsync(60_000);
      publish();
      await clock.tickAsync(0);
      sinon.assert.calledOnce(redis.subscribe);
      sinon.assert.notCalled(handle);
      expect(clock.countTimers()).to.equal(0);
    });
  }

  it("does not retry after an in-flight attempt rejects during stop", async () => {
    const initial = deferred<boolean>();
    redis.subscribe.onFirstCall().returns(initial.promise);
    construct();
    service!.stop();
    initial.reject(new Error("Redis unavailable during shutdown"));
    await clock.tickAsync(60_000);
    sinon.assert.calledOnce(redis.subscribe);
    expect(clock.countTimers()).to.equal(0);
  });
});
