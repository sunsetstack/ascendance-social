import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import {
  io as createClient,
  type Socket as ClientSocket,
} from "socket.io-client";
import type { Socket as ServerSocket } from "socket.io";
import { WebSocketServer } from "@/server/socketServer";
import { RedisService } from "@/services/redis.service";
import { RedisAuthSessionStore } from "@/services/redis/capabilities/redis-auth-session.store";
import { AuthSessionService } from "@/services/auth-session.service";
import { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import { MetricsService } from "@/metrics/metrics.service";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import User from "@/models/user.model";
import Conversation from "@/models/conversation.model";
import { EventRegistry } from "@/application/common/events/event-registry";
import {
  asUserPublicId,
  asSessionId,
  asConversationPublicId,
  asMongoId,
} from "@/types/branded";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function onceSocketEvent(
  socket: ClientSocket,
  event: string,
): Promise<unknown[]> {
  return new Promise((resolve) => {
    socket.once(event, (...args: unknown[]) => resolve(args));
  });
}

type PresenceHandlers = {
  handleConversationOpened(
    socket: ServerSocket,
    conversationId: string,
  ): Promise<void>;
  handleConversationClosed(
    socket: ServerSocket,
    conversationId?: string,
  ): Promise<void>;
};

describe("Socket presence revocation with real Redis", function () {
  this.timeout(10_000);
  const envNames = [
    "NODE_ENV",
    "REDIS_URL",
    "REDIS_AUTOCONNECT",
    "JWT_SECRET",
    "ALLOWED_ORIGINS",
  ] as const;
  const originalEnv = new Map(
    envNames.map((name) => [name, process.env[name]]),
  );
  let sandbox: sinon.SinonSandbox;
  let redis: RedisService;
  let sessions: AuthSessionService;
  let server: WebSocketServer;
  let http: HttpServer;
  let client: ClientSocket;
  let socket: ServerSocket;
  let sid: ReturnType<typeof asSessionId>;
  let userId: ReturnType<typeof asUserPublicId>;
  let conversationA: ReturnType<typeof asConversationPublicId>;
  let conversationB: ReturnType<typeof asConversationPublicId>;
  let opened: ReturnType<typeof deferred>;
  let closed: ReturnType<typeof deferred>;
  let mark: sinon.SinonSpy;
  let duplicate: sinon.SinonSpy;
  const releases: Array<() => void> = [];

  beforeEach(async () => {
    const redisUrl =
      process.env.SOCKET_PRESENCE_TEST_REDIS_URL ?? process.env.REDIS_URL;
    if (!redisUrl)
      throw new Error(
        "Set SOCKET_PRESENCE_TEST_REDIS_URL to an isolated Redis test instance",
      );
    sandbox = sinon.createSandbox();
    process.env.NODE_ENV = "test";
    process.env.REDIS_AUTOCONNECT = "false";
    process.env.REDIS_URL = redisUrl;
    process.env.JWT_SECRET = "socket-presence-regression-secret";
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
    sid = asSessionId(randomUUID());
    userId = asUserPublicId(randomUUID());
    conversationA = asConversationPublicId(randomUUID());
    conversationB = asConversationPublicId(randomUUID());
    const internalId = new Types.ObjectId();
    const metrics = sandbox.createStubInstance(MetricsService);
    redis = new RedisService(metrics);
    await redis.clientInstance.connect();
    duplicate = sandbox.spy(redis.clientInstance, "duplicate");
    const users = sandbox.createStubInstance(UserReadRepository);
    users.findByPublicId.resolves(
      new User({
        _id: internalId,
        publicId: userId,
        isBanned: false,
        isEmailVerified: true,
        authVersion: 1,
      }),
    );
    users.findInternalIdByPublicId.resolves(
      asMongoId(internalId.toHexString()),
    );
    const conversations = sandbox.createStubInstance(ConversationRepository);
    conversations.findByPublicId.callsFake(
      async (id) =>
        new Conversation({
          publicId: id,
          participants: [internalId],
          isClosed: false,
        }),
    );
    sessions = new AuthSessionService(
      new RedisAuthSessionStore(redis),
      users,
      redis,
    );
    await sessions.createSession({
      sid,
      publicId: userId,
      authVersion: 1,
      isEmailVerified: true,
      refreshToken: `${sid}.secret`,
      ttlSeconds: 300,
    });
    server = new WebSocketServer(
      redis,
      new AuthMiddlewareService(sessions, users, metrics),
      metrics,
      conversations,
      users,
    );
    const handlers = server as unknown as PresenceHandlers;
    const open = handlers.handleConversationOpened.bind(server);
    const close = handlers.handleConversationClosed.bind(server);
    opened = deferred();
    closed = deferred();
    sandbox
      .stub(handlers, "handleConversationOpened")
      .callsFake(async (...args) => {
        try {
          await open(...args);
        } finally {
          opened.resolve();
        }
      });
    sandbox
      .stub(handlers, "handleConversationClosed")
      .callsFake(async (...args) => {
        try {
          await close(...args);
        } finally {
          closed.resolve();
        }
      });
    mark = sandbox.spy(redis, "markConversationPresence");
    const subscribing = sandbox.spy(redis, "subscribe");
    http = createServer();
    server.initialize(http);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const address = http.address();
    if (!address || typeof address === "string")
      throw new Error("Expected TCP listener");
    const token = jwt.sign(
      {
        publicId: userId,
        sid,
        email: "member@example.com",
        handle: "member",
        username: "Member",
      },
      process.env.JWT_SECRET,
      { expiresIn: 300 },
    );
    client = createClient(`http://127.0.0.1:${address.port}`, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      extraHeaders: { Origin: "https://app.example.com" },
      auth: { token },
    });
    const joined = onceSocketEvent(
      client,
      EventRegistry.socketServerEvents.joinResponse,
    );
    client.connect();
    expect((await joined)[0]).to.include({ success: true, userId });
    const admitted = server.getIO().of("/").sockets.get(client.id!);
    if (!admitted) throw new Error("Expected authenticated server socket");
    socket = admitted;
    expect(await subscribing.firstCall.returnValue).to.equal(true);
    client.emit(
      EventRegistry.socketClientEvents.conversationOpened,
      conversationA,
    );
    await opened.promise;
    expect(await redis.isConversationActive(userId, conversationA)).to.equal(
      true,
    );
    expect(socket.data.activeConversationId).to.equal(conversationA);
    opened = deferred();
    mark.resetHistory();
  });

  afterEach(async () => {
    releases.splice(0).forEach((release) => release());
    if (client?.connected) client.disconnect();
    if (socket) await closed.promise;
    // Drain adapter unsubscribe commands instead of interrupting them during teardown.
    for (const subscriber of duplicate?.returnValues ?? []) {
      sandbox.stub(subscriber, "disconnect").callsFake(async () => {
        await subscriber.quit();
      });
    }
    if (server) await server.getIO().close();
    if (redis) {
      await redis.unsubscribeAll();
      if (redis.clientInstance.isOpen) {
        await redis.removeAuthSession(sid, userId);
        await redis.clientInstance.quit();
      }
    }
    sandbox?.restore();
    for (const name of envNames) {
      const value = originalEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("never writes B presence when revocation disconnects the socket during A removal", async () => {
    const clearingA = deferred();
    const releaseClear = deferred();
    releases.push(releaseClear.resolve);
    const clear = redis.clearConversationPresence.bind(redis);
    sandbox
      .stub(redis, "clearConversationPresence")
      .callsFake(async (...args) => {
        if (args[1] === conversationA) {
          clearingA.resolve();
          await releaseClear.promise;
        }
        await clear(...args);
      });
    client.emit(
      EventRegistry.socketClientEvents.conversationOpened,
      conversationB,
    );
    await clearingA.promise;
    const disconnected = onceSocketEvent(client, "disconnect");
    await sessions.revokeSession(sid);
    expect((await disconnected)[0]).to.equal("io server disconnect");
    expect(await sessions.getSession(sid)).to.equal(null);
    expect(socket.connected).to.equal(false);
    expect(socket.data.authenticated).to.equal(false);
    releaseClear.resolve();
    await opened.promise;
    await closed.promise;
    expect(
      mark.getCalls().filter(({ args }) => args[1] === conversationB),
      "presence B must never be written after completed revocation/disconnect",
    ).to.have.lengthOf(0);
    expect(await redis.isConversationActive(userId, conversationB)).to.equal(
      false,
    );
    expect(await redis.isConversationActive(userId, conversationA)).to.equal(
      false,
    );
    expect(socket.data.activeConversationId).to.equal(undefined);
  });

  it("clears A and establishes B for an authorized switch, then clears B on close", async () => {
    const clear = sandbox.spy(redis, "clearConversationPresence");
    client.emit(
      EventRegistry.socketClientEvents.conversationOpened,
      conversationB,
    );
    await opened.promise;
    sinon.assert.calledOnceWithExactly(clear, userId, conversationA, socket.id);
    expect(mark.callCount).to.equal(1);
    expect(mark.firstCall.args.slice(0, 3)).to.deep.equal([
      userId,
      conversationB,
      socket.id,
    ]);
    expect(await redis.isConversationActive(userId, conversationA)).to.equal(
      false,
    );
    expect(await redis.isConversationActive(userId, conversationB)).to.equal(
      true,
    );
    expect(socket.data.activeConversationId).to.equal(conversationB);
    client.emit(
      EventRegistry.socketClientEvents.conversationClosed,
      conversationB,
    );
    await closed.promise;
    expect(await redis.isConversationActive(userId, conversationB)).to.equal(
      false,
    );
    expect(socket.data.activeConversationId).to.equal(undefined);
  });

  it("removes B on disconnect when an already-started presence write finishes later", async () => {
    mark.restore();
    const writingB = deferred();
    const releaseWrite = deferred();
    releases.push(releaseWrite.resolve);
    const write = redis.markConversationPresence.bind(redis);
    sandbox
      .stub(redis, "markConversationPresence")
      .callsFake(async (...args) => {
        await write(...args);
        writingB.resolve();
        await releaseWrite.promise;
      });
    const clear = sandbox.spy(redis, "clearConversationPresence");
    client.emit(
      EventRegistry.socketClientEvents.conversationOpened,
      conversationB,
    );
    await writingB.promise;
    expect(await redis.isConversationActive(userId, conversationB)).to.equal(
      true,
    );
    const disconnected = onceSocketEvent(client, "disconnect");
    await sessions.revokeSession(sid);
    await disconnected;
    releaseWrite.resolve();
    await opened.promise;
    await closed.promise;
    expect(
      clear
        .getCalls()
        .some(({ args }) => args[1] === conversationB && args[2] === socket.id),
    ).to.equal(true);
    expect(await redis.isConversationActive(userId, conversationB)).to.equal(
      false,
    );
    expect(socket.data.activeConversationId).to.equal(undefined);
  });
});
