import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { createServer, Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import { WebSocketServer } from "@/server/socketServer";
import { EventRegistry } from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";
import { authCookieNames } from "@/config/cookieConfig";

describe("Socket room membership integration", () => {
  let httpServer: HttpServer;
  let webSocketServer: WebSocketServer;
  let client: ClientSocket | null;
  let redisService: {
    waitForConnection: sinon.SinonStub;
    markConversationPresence: sinon.SinonStub;
    clearConversationPresence: sinon.SinonStub;
    isConversationActive: sinon.SinonStub;
  };
  let metricsService: sinon.SinonStubbedInstance<MetricsService>;
  let authCalls: sinon.SinonStub;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalAllowedOrigins = process.env.ALLOWED_ORIGINS;

  async function startServer(): Promise<void> {
    const authMiddlewareService = {
      required: () => authCalls,
    };

    httpServer = createServer();

    webSocketServer = new WebSocketServer(
      redisService as any,
      authMiddlewareService as any,
      metricsService as any,
    );

    webSocketServer.initialize(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });
  }

  beforeEach(async () => {
    client = null;
    process.env.NODE_ENV = "production";
    process.env.ALLOWED_ORIGINS = "https://app.example.com";
    authCalls = sinon.stub();
    authCalls.callsFake(
      (req: any, _res: any, next: (error?: unknown) => void): void => {
        if (
          req.cookies?.[authCookieNames.accessToken] !== "test-access-token"
        ) {
          next(new Error("Missing test access token"));
          return;
        }

        req.decodedUser = {
          id: "internal-user-1",
          publicId: "user-123",
        };

        next();
      },
    );

    redisService = {
      waitForConnection: sinon.stub().resolves(false),
      markConversationPresence: sinon.stub().resolves(),
      clearConversationPresence: sinon.stub().resolves(),
      isConversationActive: sinon.stub().resolves(false),
    };
    metricsService = sinon.createStubInstance(MetricsService);

    await startServer();
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

    process.env.NODE_ENV = originalNodeEnv;
    if (originalAllowedOrigins === undefined) {
      delete process.env.ALLOWED_ORIGINS;
    } else {
      process.env.ALLOWED_ORIGINS = originalAllowedOrigins;
    }

    sinon.restore();
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
      userId: "user-123",
    });

    const roomSockets = await webSocketServer
      .getIO()
      .in("user-123")
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
        userId: "user-123",
      });
      expect(authCalls.calledOnce).to.equal(true);
      expect(
        await webSocketServer.getIO().in("user-123").fetchSockets(),
      ).to.have.lengthOf(1);

      client.disconnect();
      client = null;
      authCalls.resetHistory();
    }
  });

  it("rejects an untrusted origin before authentication or room joining", async () => {
    const rejectedClient = createSocket({ origin: "https://evil.example" });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient);

    expect(authCalls.called).to.equal(false);
    expect(
      await webSocketServer.getIO().in("user-123").fetchSockets(),
    ).to.have.lengthOf(0);
  });

  it("rejects a trusted origin used as an attacker-controlled hostname", async () => {
    const rejectedClient = createSocket({
      origin: "https://app.example.com.attacker.test",
    });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient);

    expect(authCalls.called).to.equal(false);
  });

  it("rejects Origin null", async () => {
    const rejectedClient = createSocket({ origin: "null" });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient);

    expect(authCalls.called).to.equal(false);
  });

  it("rejects missing Origin when an ambient auth cookie is present", async () => {
    for (const transport of ["websocket", "polling"] as const) {
      const rejectedClient = createSocket({
        cookie: `${authCookieNames.accessToken}=ambient-token`,
        transports: [transport],
      });
      client = rejectedClient;

      await expectConnectionRejected(rejectedClient);

      expect(authCalls.called).to.equal(false);
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

    httpServer = createServer();

    webSocketServer = new WebSocketServer(
      redisService as any,
      {
        required: () => authCalls,
      } as any,
      metricsService as any,
    );

    webSocketServer.initialize(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });

    const rejectedClient = createSocket({
      origin: "https://app.example.com",
      cookie: `${authCookieNames.accessToken}=test-access-token`,
    });
    client = rejectedClient;

    await expectConnectionRejected(rejectedClient);

    expect(authCalls.called).to.equal(false);
    expect(
      await webSocketServer.getIO().in("user-123").fetchSockets(),
    ).to.have.lengthOf(0);
  });

  it("rejects manual joins for another user's room", async () => {
    const connected = await connectClientWithInitialJoin();
    client = connected.socket;

    const rejectedJoinResponse = onceSocketEvent<{
      success: boolean;
      error: string;
    }>(client, EventRegistry.socketServerEvents.joinResponse);

    client.emit(EventRegistry.socketClientEvents.join, "user-456");
    const response = await rejectedJoinResponse;

    expect(response).to.deep.equal({
      success: false,
      error: "Forbidden room join",
    });

    const forbiddenRoomSockets = await webSocketServer
      .getIO()
      .in("user-456")
      .fetchSockets();
    expect(forbiddenRoomSockets).to.have.lengthOf(0);
  });

  it("tracks and clears conversation presence for the authenticated user", async () => {
    const connected = await connectClientWithInitialJoin();
    client = connected.socket;

    client.emit(EventRegistry.socketClientEvents.conversationOpened, "conv-1");
    await waitFor(() => redisService.markConversationPresence.calledOnce);

    expect(redisService.markConversationPresence.firstCall.args[0]).to.equal(
      "user-123",
    );
    expect(redisService.markConversationPresence.firstCall.args[1]).to.equal(
      "conv-1",
    );
    expect(redisService.markConversationPresence.firstCall.args[2]).to.equal(
      client.id,
    );

    client.emit(EventRegistry.socketClientEvents.conversationClosed, "conv-1");
    await waitFor(() => redisService.clearConversationPresence.calledOnce);

    expect(redisService.clearConversationPresence.firstCall.args).to.deep.equal(
      ["user-123", "conv-1", client.id],
    );
  });

  async function connectClientWithInitialJoin<T = unknown>(
    options: SocketOptions = {},
  ): Promise<{
    socket: ClientSocket;
    joinResponse: T;
  }> {
    const socket = createSocket({
      origin: "https://app.example.com",
      cookie: `${authCookieNames.accessToken}=test-access-token`,
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
    const address = httpServer.address() as AddressInfo;
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

  async function expectConnectionRejected(socket: ClientSocket): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => {
        reject(new Error("Socket unexpectedly connected"));
      });
      socket.once("connect_error", () => resolve());
      socket.connect();
    });
    socket.disconnect();
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
