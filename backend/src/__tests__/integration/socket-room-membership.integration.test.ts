import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { createServer, get, Server as HttpServer } from "http";
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { createClient as createRedisClient } from "redis";
import { Types } from "mongoose";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import { WebSocketServer } from "@/server/socketServer";
import { EventRegistry } from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";
import { authCookieNames } from "@/config/cookieConfig";
import { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import { AuthSessionService } from "@/services/auth-session.service";
import { RedisService } from "@/services/redis.service";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import Conversation from "@/models/conversation.model";
import User from "@/models/user.model";
import { asConversationPublicId, asMongoId, asSessionId, asUserPublicId, asRefreshTokenHash } from "@/types/branded";
import { Errors } from "@/utils/errors";

describe("Socket room membership integration", () => {
  let httpServer: HttpServer;
  let webSocketServer: WebSocketServer;
  let client: ClientSocket | null;
  let sandbox: sinon.SinonSandbox;
  let redisService: sinon.SinonStubbedInstance<RedisService>;
  let metricsService: sinon.SinonStubbedInstance<MetricsService>;
  let authSessionService: sinon.SinonStubbedInstance<AuthSessionService>;
  let userReadRepository: sinon.SinonStubbedInstance<UserReadRepository>;
  let conversationRepository: sinon.SinonStubbedInstance<ConversationRepository>;
  let authMiddlewareService: AuthMiddlewareService;
  let authCalls: sinon.SinonSpy;
  let accessToken: string;
  let conversation: InstanceType<typeof Conversation>;
  const userId = asUserPublicId("de802f94-f823-4d87-a535-144b904f10ac");
  const otherUserId = asUserPublicId("512d8169-d190-4f20-9514-571a8d2274f4");
  const sessionId = asSessionId("0199e057-5109-4b2a-bdca-5591f5639086");
  const internalId = new Types.ObjectId("507f1f77bcf86cd799439011");
  const conversationId = asConversationPublicId("edb3b63b-a83f-4ee7-a114-84a8b2c60a92");
  const envNames = ["NODE_ENV", "ALLOWED_ORIGINS", "JWT_SECRET", "ACTIVE_CONVERSATION_TTL_SECONDS"] as const;
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));

  async function startServer(): Promise<void> {
    httpServer = createServer();
    webSocketServer = new WebSocketServer(
      redisService,
      authMiddlewareService,
      metricsService,
      conversationRepository,
      userReadRepository,
    );
    webSocketServer.initialize(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    client = null;
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
    process.env.JWT_SECRET = "socket-membership-test-secret";
    process.env.ACTIVE_CONVERSATION_TTL_SECONDS = "90";
    metricsService = sandbox.createStubInstance(MetricsService);
    redisService = sandbox.createStubInstance(RedisService);
    authSessionService = sandbox.createStubInstance(AuthSessionService);
    userReadRepository = sandbox.createStubInstance(UserReadRepository);
    conversationRepository = sandbox.createStubInstance(ConversationRepository);

    // Exercise the real single-node adapter; replace only its Redis I/O.
    const publisher = createRedisClient();
    const subscriber = createRedisClient();
    const channels = new Set<string>();
    let ready = false;
    sandbox.stub(publisher, "isReady").get(() => true);
    sandbox.stub(subscriber, "isReady").get(() => ready);
    sandbox.stub(subscriber, "isOpen").get(() => ready);
    sandbox.stub(publisher, "duplicate").returns(subscriber);
    sandbox.stub(subscriber, "connect").callsFake(async () => {
      ready = true;
      return subscriber;
    });
    sandbox.stub(subscriber, "disconnect").callsFake(async () => {
      ready = false;
    });
    sandbox.stub(subscriber, "pSubscribe").resolves();
    sandbox.stub(subscriber, "pUnsubscribe").resolves();
    sandbox.stub(subscriber, "subscribe").callsFake(async (names) => {
      for (const name of typeof names === "string" ? [names] : names) channels.add(name);
    });
    sandbox.stub(subscriber, "unsubscribe").callsFake(async (names) => {
      if (names === undefined) { channels.clear(); return; }
      for (const name of typeof names === "string" ? [names] : names) channels.delete(name);
    });
    sandbox.stub(publisher, "sendCommand").callsFake(async (args) => {
      expect(args.slice(0, 2)).to.deep.equal(["PUBSUB", "NUMSUB"]);
      const channel = args[2].toString();
      return [channel, channels.has(channel) ? 1 : 0];
    });
    sandbox.stub(redisService, "clientInstance").get(() => publisher);
    redisService.waitForConnection.resolves(true);
    redisService.consumeFixedWindowRateLimit.resolves(true);
    redisService.subscribe.resolves(true);
    redisService.markConversationPresence.resolves();
    redisService.clearConversationPresence.resolves();
    redisService.isConversationActive.resolves(false);

    const now = Date.now();
    authSessionService.assertAccessSession.callsFake(async (sid, publicId) => {
      expect([sid, publicId]).to.deep.equal([sessionId, userId]);
      return {
        sid: sessionId, publicId: userId, isEmailVerified: true, authVersion: 3,
        refreshTokenHash: asRefreshTokenHash("stored-refresh-token-hash"),
        refreshVersion: 1, createdAt: now, lastSeenAt: now, status: "active",
      };
    });
    userReadRepository.findByPublicId.resolves(new User({
      _id: internalId, publicId: userId, email: "member@example.com",
      handle: "member", username: "Member", isAdmin: false,
      isBanned: false, isEmailVerified: true, authVersion: 3,
    }));
    userReadRepository.findInternalIdByPublicId.resolves(asMongoId(internalId.toHexString()));
    conversation = new Conversation({
      publicId: conversationId, participants: [internalId, new Types.ObjectId()],
      participantHash: "members", isClosed: false,
    });
    conversationRepository.findByPublicId.resolves(conversation);
    authMiddlewareService = new AuthMiddlewareService(authSessionService, userReadRepository, metricsService);
    const handler: RequestHandler = authMiddlewareService.required();
    authCalls = sandbox.spy(handler);
    sandbox.stub(authMiddlewareService, "required").returns(authCalls);
    accessToken = jwt.sign({
      publicId: userId, email: "member@example.com", handle: "member", username: "Member",
      sid: sessionId, isAdmin: false, exp: Math.floor(now / 1000) + 300,
    }, process.env.JWT_SECRET);

    await startServer();
    const baseline = await connectClientWithInitialJoin();
    expect(baseline.joinResponse).to.include({ success: true, userId });
    baseline.socket.disconnect();
    await waitFor(() => webSocketServer.getIO().of("/").sockets.size === 0);
    authCalls.resetHistory();
    authSessionService.assertAccessSession.resetHistory();
    userReadRepository.findByPublicId.resetHistory();
    redisService.consumeFixedWindowRateLimit.resetHistory();
  });

  afterEach(async () => {
    if (client) {
      client.disconnect();
      client = null;
    }

    webSocketServer.getIO().close();

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    for (const name of envNames) {
      const value = originalEnv.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    sandbox.restore();
  });

  it("auto-joins the authenticated user's room", async () => {
    const connected = await connectClientWithInitialJoin<{
      success: boolean;
      userId: string;
    }>();
    client = connected.socket;
    const joinResponse = connected.joinResponse;

    expect(joinResponse).to.include({
      success: true,
      userId,
    });

    const roomSockets = await webSocketServer
      .getIO()
      .in(userId)
      .fetchSockets();
    expect(roomSockets).to.have.lengthOf(1);
    expect(
      metricsService.recordSocketEventEmitted.calledWith(
        EventRegistry.socketServerEvents.joinResponse,
        "socket",
      ),
    ).to.be.true;
  });

  it("accepts an exact origin and authenticates for websocket and polling", async () => {
    for (const transport of ["websocket", "polling"] as const) {
      const connected = await connectClientWithInitialJoin({
        origin: "https://app.example.com",
        transports: [transport],
      });
      client = connected.socket;

      expect(connected.joinResponse).to.include({
        success: true,
        userId,
      });
      expect(authCalls.calledOnce).to.equal(true);
      expect(
        await webSocketServer.getIO().in(userId).fetchSockets(),
      ).to.have.lengthOf(1);

      client.disconnect();
      client = null;
      authCalls.resetHistory();
    }
  });

  it("rejects an untrusted origin before authentication or room joining", async () => {
    const rejectedClient = createSocket({
      origin: "https://evil.example",
      cookie: `${authCookieNames.accessToken}=${accessToken}`,
    });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient, "Invalid origin");

    expect(authCalls.called).to.equal(false);
    sinon.assert.notCalled(authSessionService.assertAccessSession);
    sinon.assert.notCalled(redisService.consumeFixedWindowRateLimit);
    expect(
      await webSocketServer.getIO().in(userId).fetchSockets(),
    ).to.have.lengthOf(0);
  });

  it("rejects a trusted origin used as an attacker-controlled hostname", async () => {
    const rejectedClient = createSocket({
      origin: "https://app.example.com.attacker.test",
      cookie: `${authCookieNames.accessToken}=${accessToken}`,
    });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient, "Invalid origin");

    expect(authCalls.called).to.equal(false);
    sinon.assert.notCalled(authSessionService.assertAccessSession);
    sinon.assert.notCalled(redisService.consumeFixedWindowRateLimit);
  });

  it("rejects Origin null", async () => {
    const rejectedClient = createSocket({
      origin: "null",
      cookie: `${authCookieNames.accessToken}=${accessToken}`,
    });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient, "Invalid origin");

    expect(authCalls.called).to.equal(false);
    sinon.assert.notCalled(authSessionService.assertAccessSession);
    sinon.assert.notCalled(redisService.consumeFixedWindowRateLimit);
  });

  it("rejects missing Origin when an ambient auth cookie is present", async () => {
    for (const transport of ["websocket", "polling"] as const) {
      const rejectedClient = createSocket({
        cookie: `${authCookieNames.accessToken}=${accessToken}`,
        transports: [transport],
      });
      client = rejectedClient;

      await expectConnectionRejected(rejectedClient, "Origin is required for cookie-authenticated sockets");

      expect(authCalls.called).to.equal(false);
      sinon.assert.notCalled(authSessionService.assertAccessSession);
      sinon.assert.notCalled(redisService.consumeFixedWindowRateLimit);
      client = null;
      authCalls.resetHistory();
    }
  });

  it("fails closed when production has no configured origins", async () => {
    // Shut down the server created by beforeEach.
    webSocketServer.getIO().close();

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });

    // Configure the environment before initializing the replacement server.
    process.env.NODE_ENV = "production";
    delete process.env.ALLOWED_ORIGINS;

    await startServer();

    const rejectedClient = createSocket({
      origin: "https://app.example.com",
      cookie: `${authCookieNames.accessToken}=${accessToken}`,
    });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient, "Invalid origin");

    expect(authCalls.called).to.equal(false);
    sinon.assert.notCalled(authSessionService.assertAccessSession);
    sinon.assert.notCalled(redisService.consumeFixedWindowRateLimit);
    expect(
      await webSocketServer.getIO().in(userId).fetchSockets(),
    ).to.have.lengthOf(0);
  });

  it("rejects manual joins for another user's room", async () => {
    const connected = await connectClientWithInitialJoin();
    client = connected.socket;

    const rejectedJoinResponse = onceSocketEvent<{
      success: boolean;
      error: string;
    }>(client, EventRegistry.socketServerEvents.joinResponse);

    client.emit(EventRegistry.socketClientEvents.join, otherUserId);
    const response = await rejectedJoinResponse;

    expect(response).to.deep.equal({
      success: false,
      error: "Forbidden room join",
    });

    const forbiddenRoomSockets = await webSocketServer
      .getIO()
      .in(otherUserId)
      .fetchSockets();
    expect(forbiddenRoomSockets).to.have.lengthOf(0);
  });

  it("tracks and clears conversation presence for the authenticated user", async () => {
    const connected = await connectClientWithInitialJoin();
    client = connected.socket;
    const socketId = client.id;
    if (!socketId) throw new Error("Expected a connected client socket");

    client.emit(EventRegistry.socketClientEvents.conversationOpened, conversationId);
    await waitFor(() => redisService.markConversationPresence.calledOnce);

    sinon.assert.calledOnceWithExactly(redisService.markConversationPresence, userId, conversationId, socketId, 90);
    sinon.assert.calledOnceWithExactly(conversationRepository.findByPublicId, conversationId, { populateParticipants: true });
    sinon.assert.calledOnceWithExactly(userReadRepository.findInternalIdByPublicId, userId);
    const socket = webSocketServer.getIO().of("/").sockets.get(socketId);
    if (!socket) throw new Error("Expected an admitted server socket");
    expect(socket.data.activeConversationId).to.equal(conversationId);

    client.emit(EventRegistry.socketClientEvents.conversationClosed, conversationId);
    await waitFor(() => redisService.clearConversationPresence.calledOnce);

    expect(redisService.clearConversationPresence.firstCall.args).to.deep.equal(
      [userId, conversationId, socketId],
    );
    await waitFor(() => socket.data.activeConversationId === undefined);
  });

  it("disconnects a nonmember without storing conversation presence", async () => {
    client = (await connectClientWithInitialJoin()).socket;
    conversation.participants = [new Types.ObjectId(), new Types.ObjectId()];
    const disconnected = onceSocketEvent(client, "disconnect");
    client.emit(EventRegistry.socketClientEvents.conversationOpened, conversationId);
    expect(await disconnected).to.equal("io server disconnect");
    sinon.assert.calledOnceWithExactly(conversationRepository.findByPublicId, conversationId, { populateParticipants: true });
    sinon.assert.calledOnceWithExactly(userReadRepository.findInternalIdByPublicId, userId);
    sinon.assert.notCalled(redisService.markConversationPresence);
    sinon.assert.notCalled(redisService.clearConversationPresence);
  });

  it("disconnects a member of a closed conversation without storing presence", async () => {
    client = (await connectClientWithInitialJoin()).socket;
    conversation.isClosed = true;
    const disconnected = onceSocketEvent(client, "disconnect");
    client.emit(EventRegistry.socketClientEvents.conversationOpened, conversationId);
    expect(await disconnected).to.equal("io server disconnect");
    sinon.assert.calledOnceWithExactly(userReadRepository.findInternalIdByPublicId, userId);
    sinon.assert.notCalled(redisService.markConversationPresence);
  });

  it("rejects malformed conversation IDs before looking up membership", async () => {
    client = (await connectClientWithInitialJoin()).socket;
    const disconnected = onceSocketEvent(client, "disconnect");
    client.emit(EventRegistry.socketClientEvents.conversationOpened, "conv-1");
    expect(await disconnected).to.equal("io server disconnect");
    sinon.assert.notCalled(conversationRepository.findByPublicId);
    sinon.assert.notCalled(redisService.markConversationPresence);
  });

  it("revalidates a session before allowing a connected socket to open a conversation", async () => {
    client = (await connectClientWithInitialJoin()).socket;
    authSessionService.assertAccessSession.resetHistory();
    authSessionService.assertAccessSession.rejects(Errors.authentication("Session is invalid or expired"));
    const disconnected = onceSocketEvent(client, "disconnect");
    client.emit(EventRegistry.socketClientEvents.conversationOpened, conversationId);
    expect(await disconnected).to.equal("io server disconnect");
    sinon.assert.calledOnceWithExactly(authSessionService.assertAccessSession, sessionId, userId);
    sinon.assert.notCalled(conversationRepository.findByPublicId);
    sinon.assert.notCalled(redisService.markConversationPresence);
    expect(await webSocketServer.getIO().in(userId).fetchSockets()).to.have.lengthOf(0);
  });

  it("revalidates again after membership lookup before storing presence", async () => {
    client = (await connectClientWithInitialJoin()).socket;
    authSessionService.assertAccessSession.resetHistory();
    authSessionService.assertAccessSession.onSecondCall().rejects(Errors.authentication("Session is invalid or expired"));
    const disconnected = onceSocketEvent(client, "disconnect");
    client.emit(EventRegistry.socketClientEvents.conversationOpened, conversationId);
    expect(await disconnected).to.equal("io server disconnect");
    expect(authSessionService.assertAccessSession.getCalls().map(({ args }) => args)).to.deep.equal([
      [sessionId, userId], [sessionId, userId],
    ]);
    sinon.assert.calledOnceWithExactly(conversationRepository.findByPublicId, conversationId, { populateParticipants: true });
    sinon.assert.calledOnceWithExactly(userReadRepository.findInternalIdByPublicId, userId);
    expect(conversationRepository.findByPublicId.firstCall.calledBefore(authSessionService.assertAccessSession.secondCall)).to.equal(true);
    sinon.assert.notCalled(redisService.markConversationPresence);
    expect(await webSocketServer.getIO().in(userId).fetchSockets()).to.have.lengthOf(0);
  });

  it("rejects an expired signed credential for token expiry", async () => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("Expected configured authentication secret");
    const expiredToken = jwt.sign({
      publicId: userId, email: "member@example.com", handle: "member", username: "Member",
      sid: sessionId, isAdmin: false, exp: Math.floor(Date.now() / 1000) - 1,
    }, secret);
    client = createSocket({
      origin: "https://app.example.com",
      cookie: `${authCookieNames.accessToken}=${expiredToken}`,
    });
    const rejection = new Promise<Error>((resolve, reject) => {
      client?.once("connect_error", resolve);
      client?.once("connect", () => reject(new Error("Expired credential admitted")));
    });
    client.connect();
    const error = await rejection;
    sinon.assert.calledOnce(authCalls);
    sinon.assert.notCalled(authSessionService.assertAccessSession);
    sinon.assert.notCalled(userReadRepository.findByPublicId);
    expect(await webSocketServer.getIO().in(userId).fetchSockets()).to.have.lengthOf(0);
    expect(error.message).to.equal("Access token expired");
  });

  async function connectClientWithInitialJoin<T = unknown>(
    options: SocketOptions = {},
  ): Promise<{
    socket: ClientSocket;
    joinResponse: T;
  }> {
    const socket = createSocket({
      origin: "https://app.example.com",
      cookie: `${authCookieNames.accessToken}=${accessToken}`,
      ...options,
    });

    const joinResponsePromise = onceSocketEvent<T>(
      socket,
      EventRegistry.socketServerEvents.joinResponse,
    );

    await connectSocket(socket);

    return {
      socket,
      joinResponse: await joinResponsePromise,
    };
  }

  interface SocketOptions {
    origin?: string;
    cookie?: string;
    transports?: Array<"websocket" | "polling">;
  }

  function createSocket(options: SocketOptions = {}): ClientSocket {
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const extraHeaders: Record<string, string> = {};
    if (options.origin !== undefined) {
      extraHeaders.Origin = options.origin;
    }
    if (options.cookie !== undefined) {
      extraHeaders.Cookie = options.cookie;
    }

    return createClient(`http://127.0.0.1:${address.port}`, {
      autoConnect: false,
      reconnection: false,
      timeout: 1_000,
      transports: options.transports ?? ["websocket"],
      extraHeaders,
    });
  }

  async function connectSocket(socket: ClientSocket): Promise<void> {
    const connected = new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });

    socket.connect();
    await connected;
  }

  async function expectConnectionRejected(socket: ClientSocket, reason: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        reject(new Error("Socket unexpectedly connected"));
      });
      socket.once("connect_error", () => resolve());
      socket.connect();
    });
    socket.disconnect();
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    // Engine.IO exposes the admission reason on a polling handshake, even when
    // a websocket client only receives a generic transport error.
    const rejection = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = get(`http://127.0.0.1:${address.port}/socket.io/?EIO=4&transport=polling`, {
        headers: socket.io.opts.extraHeaders,
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body }));
      });
      request.on("error", reject);
    });
    expect(rejection.status).to.equal(403);
    expect(JSON.parse(rejection.body)).to.deep.equal({ code: 4, message: reason });
  }

  function onceSocketEvent<T = unknown>(
    socket: ClientSocket,
    event: string,
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      socket.once(event, (payload: T) => resolve(payload));
    });
  }

  async function waitFor(assertion: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (assertion()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error("Timed out waiting for async socket assertion");
  }
});
