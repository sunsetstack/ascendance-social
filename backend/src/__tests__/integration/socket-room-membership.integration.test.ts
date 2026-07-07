import "reflect-metadata";
import { expect } from "chai";
import sinon from "sinon";
import { createServer, Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { io as createClient, Socket as ClientSocket } from "socket.io-client";
import { WebSocketServer } from "@/server/socketServer";
import { EventRegistry } from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";

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

  beforeEach(async () => {
    client = null;
    redisService = {
      waitForConnection: sinon.stub().resolves(false),
      markConversationPresence: sinon.stub().resolves(),
      clearConversationPresence: sinon.stub().resolves(),
      isConversationActive: sinon.stub().resolves(false),
    };
    metricsService = sinon.createStubInstance(MetricsService);

    const authMiddlewareService = {
      required:
        () =>
        (req: any, _res: any, next: (error?: unknown) => void): void => {
          req.decodedUser = {
            id: "internal-user-1",
            publicId: "user-123",
          };
          next();
        },
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

    const roomSockets = await webSocketServer.getIO().in("user-123").fetchSockets();
    expect(roomSockets).to.have.lengthOf(1);
    expect(
      metricsService.recordSocketEventEmitted.calledWith(
        EventRegistry.socketServerEvents.joinResponse,
        "socket",
      ),
    ).to.be.true;
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

  async function connectClientWithInitialJoin<T = unknown>(): Promise<{
    socket: ClientSocket;
    joinResponse: T;
  }> {
    const socket = createSocket();
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

  function createSocket(): ClientSocket {
    const address = httpServer.address() as AddressInfo;
    return createClient(`http://127.0.0.1:${address.port}`, {
      autoConnect: false,
      transports: ["websocket"],
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
