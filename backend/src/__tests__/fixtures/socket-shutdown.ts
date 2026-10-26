import "reflect-metadata";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import sinon from "sinon";
import type { RequestHandler } from "express";
import type { RedisClientType } from "redis";
import { io as createClient } from "socket.io-client";
import { Server as SocketIOServer } from "socket.io";
import { WebSocketServer } from "@/server/socketServer";
import { RedisService } from "@/services/redis.service";
import { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import { MetricsService } from "@/metrics/metrics.service";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { RealTimeFeedService } from "@/services/feed/real-time-feed.service";
import { EventRegistry } from "@/application/common/events/event-registry";
import { asUserPublicId, asSessionId } from "@/types/branded";

async function run(): Promise<void> {
  const metrics = sinon.createStubInstance(MetricsService);
  const redis = new RedisService(metrics);
  await redis.clientInstance.connect();
  const auth = sinon.createStubInstance(AuthMiddlewareService);
  const user = {
    publicId: asUserPublicId(randomUUID()), sid: asSessionId(randomUUID()),
    email: "shutdown@example.com", handle: "shutdown", username: "Shutdown",
    isAdmin: false,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const authenticate: RequestHandler = (req, _res, next) => { req.decodedUser = user; next(); };
  auth.required.returns(authenticate);
  auth.assertActiveSession.resolves();
  const sockets = new WebSocketServer(redis, auth, metrics,
    sinon.createStubInstance(ConversationRepository), sinon.createStubInstance(UserReadRepository));
  const http = createServer();
  const subscribe = sinon.spy(redis, "subscribe");
  sockets.initialize(http);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const state = sockets as unknown as {
    adapterReady: Promise<boolean>;
    adapterSubscriber: RedisClientType;
  };
  assert.equal(await state.adapterReady, true);
  assert.equal(sockets.getIO().close, SocketIOServer.prototype.close, "Socket.IO's close API must remain untouched");
  assert.equal(sockets.getIO().of("/").adapter.constructor.name, "RedisAdapter");
  assert.equal(await subscribe.firstCall.returnValue, true);
  const realtime = new RealTimeFeedService(redis, sockets, [], metrics);
  assert.equal(await subscribe.secondCall.returnValue, true);
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const client = createClient(`http://127.0.0.1:${address.port}`, {
    autoConnect: false, reconnection: false, transports: ["websocket"],
    extraHeaders: { Origin: "https://shutdown.example.com" },
  });
  const joined = new Promise<void>((resolve, reject) => {
    client.once(EventRegistry.socketServerEvents.joinResponse, () => resolve());
    client.once("connect_error", reject);
  });
  client.connect();
  await joined;
  const socket = sockets.getIO().of("/").sockets.get(client.id!);
  assert.ok(socket);
  const clientDisconnected = new Promise<void>((resolve) => client.once("disconnect", () => resolve()));
  const subscriber = state.adapterSubscriber;
  const hardDisconnect = sinon.spy(subscriber, "disconnect");
  const unsubscribe = sinon.spy(subscriber, "unsubscribe");
  const patternUnsubscribe = sinon.spy(subscriber, "pUnsubscribe");
  const channels = [EventRegistry.redisChannels.sessionRevocations,
    EventRegistry.redisChannels.feedUpdates, EventRegistry.redisChannels.messagingUpdates,
    EventRegistry.redisChannels.notificationUpdates];
  for (const channel of channels) {
    assert.equal((await redis.clientInstance.pubSubNumSub(channel))[channel], 1);
  }
  http.once("close", () => {
    realtime.stop();
    console.log(JSON.stringify({ adapterUnsubscribeCommands: unsubscribe.callCount + patternUnsubscribe.callCount,
      hardDisconnectCalls: hardDisconnect.callCount }));
  });
  const mode = process.argv[2];
  if (mode === "delayed") {
    await redis.clientInstance.sendCommand(["CLIENT", "PAUSE", "1000", "ALL"]);
  }
  let closing: Promise<void>;
  if (mode === "external-http") {
    const serverDisconnected = new Promise<void>((resolve) => socket.once("disconnect", () => resolve()));
    client.disconnect();
    await serverDisconnected;
    await new Promise<void>((resolve, reject) => http.close((error) => error ? reject(error) : resolve()));
    closing = sockets.close();
  } else {
    closing = sockets.close();
  }
  assert.equal(socket.connected, false);
  assert.equal(socket.data.authenticated, false);
  if (mode === "repeat") {
    assert.equal(sockets.close(), closing, "concurrent close calls must share completion");
  }
  await closing;
  await clientDisconnected;
  assert.equal(client.connected, false);
  assert.equal(sockets.getIO().of("/").sockets.size, 0);
  // Give Node its unhandled-rejection checkpoint; strict mode makes any rejection fatal.
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(subscriber.isOpen, false);
  assert.equal(hardDisconnect.callCount, 0);
  assert.equal(patternUnsubscribe.callCount, 1);
  assert.equal(unsubscribe.callCount, 3);
  assert.equal(http.listening, false);
  for (const channel of channels) {
    assert.equal((await redis.clientInstance.pubSubNumSub(channel))[channel], 0,
      "application Pub/Sub subscribers must be closed through RedisService");
  }
  assert.equal(redis.clientInstance.isReady, true, "socket shutdown does not own the shared publisher");
  if (mode === "repeat") {
    await sockets.close();
    assert.equal(patternUnsubscribe.callCount, 1);
    assert.equal(unsubscribe.callCount, 3);
  }
  await redis.clientInstance.quit();
  client.disconnect();
  console.log("Socket shutdown completed without unhandled rejections");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});
