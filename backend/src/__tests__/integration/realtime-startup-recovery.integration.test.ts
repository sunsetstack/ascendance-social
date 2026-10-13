import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import type { Server as SocketIOServer } from "socket.io";
import { RedisService } from "@/services/redis.service";
import { MetricsService } from "@/metrics/metrics.service";
import { WebSocketServer } from "@/server/socketServer";
import { RealTimeFeedService, type FeedUpdateMessage } from "@/services/feed/real-time-feed.service";
import { EventRegistry } from "@/application/common/events/event-registry";

describe("Realtime startup recovery with real Redis", function () {
  this.timeout(10_000);
  let sandbox: sinon.SinonSandbox;
  let redis: RedisService;
  let service: RealTimeFeedService | undefined;
  const envNames = ["REDIS_URL", "REDIS_AUTOCONNECT"] as const;
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));

  afterEach(async () => {
    service?.stop();
    if (redis) {
      await redis.unsubscribeAll();
      if (redis.clientInstance.isOpen) await redis.clientInstance.quit();
    }
    sandbox?.restore();
    for (const name of envNames) {
      const value = originalEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("subscribes and restores dispatch after Redis becomes ready without replacing the service", async () => {
    const url = process.env.REALTIME_TEST_REDIS_URL ?? process.env.REDIS_URL;
    if (!url) throw new Error("Set REALTIME_TEST_REDIS_URL to an isolated Redis test instance");
    process.env.REDIS_URL = url;
    process.env.REDIS_AUTOCONNECT = "false";
    sandbox = sinon.createSandbox();
    const metrics = sandbox.createStubInstance(MetricsService);
    redis = new RedisService(metrics);
    const clock = sandbox.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const subscribe = sandbox.spy(redis, "subscribe");
    const sockets = sandbox.createStubInstance(WebSocketServer);
    sockets.getIO.returns({} as SocketIOServer);
    let received!: () => void;
    const delivered = new Promise<void>((resolve) => { received = resolve; });
    const handle = sandbox.stub().callsFake(async () => { received(); });
    const message: FeedUpdateMessage = {
      type: EventRegistry.realtimeMessageTypes.newNotification,
      eventId: "redis-startup-recovery", timestamp: "2026-10-08T00:00:00.000Z",
    };
    service = new RealTimeFeedService(redis, sockets, [{ messageType: message.type, handle }], metrics);
    const original = service;
    await clock.tickAsync(1500);
    sinon.assert.calledOnce(subscribe);
    expect(await subscribe.firstCall.returnValue).to.equal(false);
    sinon.assert.notCalled(handle);
    await redis.clientInstance.connect();
    expect(redis.clientInstance.isReady).to.equal(true);
    await clock.tickAsync(5000);
    expect(subscribe.callCount, "a ready Redis boundary must receive a new subscription attempt").to.equal(2);
    expect(await subscribe.secondCall.returnValue).to.equal(true);
    expect(service).to.equal(original);
    const channel = EventRegistry.redisChannels.notificationUpdates;
    const channels = [EventRegistry.redisChannels.feedUpdates, EventRegistry.redisChannels.messagingUpdates, channel];
    for (const subscribedChannel of channels) {
      expect((await redis.clientInstance.pubSubNumSub(subscribedChannel))[subscribedChannel]).to.equal(1);
    }
    await redis.publish(channel, message);
    await delivered;
    sinon.assert.calledOnceWithExactly(handle, sockets.getIO.firstCall.returnValue, message, channel);
    await clock.tickAsync(60_000);
    expect(subscribe.callCount).to.equal(2);
    for (const subscribedChannel of channels) {
      expect((await redis.clientInstance.pubSubNumSub(subscribedChannel))[subscribedChannel]).to.equal(1);
    }
    service.stop();
    await redis.unsubscribeAll();
    await clock.tickAsync(60_000);
    expect(subscribe.callCount).to.equal(2);
    for (const subscribedChannel of channels) {
      expect((await redis.clientInstance.pubSubNumSub(subscribedChannel))[subscribedChannel]).to.equal(0);
    }
  });
});
