import { UserPublicId, asConversationPublicId } from "@/types/branded";
import type { DecodedUser } from "@/types";
import type { IncomingMessage } from "node:http";
import { Request, RequestHandler } from "express";
import { Server as HttpServer } from "http";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { Server as SocketIOServer, Socket as SocketIOSocket } from "socket.io";
import { injectable, inject } from "tsyringe";
import cookieParser from "cookie-parser";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { createAdapter } from "@socket.io/redis-adapter";
import { RedisService } from "@/services/redis.service";
import { authCookieNames } from "@/config/cookieConfig";
import { getAllowedOrigins, isAllowedOrigin } from "@/config/corsConfig";
import { TOKENS } from "@/types/tokens";
import { EventRegistry } from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";
import { getSocketIpRateLimitKey, type TrustProxy } from "@/utils/request-ip";
import { isValidPublicId } from "@/utils/sanitizers";
import { ConversationRepository } from "@/repositories/conversation.repository";
import type { IUserReadRepository } from "@/repositories/interfaces";
import { ensureConversationAccess } from "@/application/messaging/messaging-support";
import {
  assertSocketSession,
  registerSocketSessionValidator,
  validateSocketSession,
} from "./socket-security";

let ioInstance: SocketIOServer | null = null;
let viewingStateRedisService: RedisService | null = null;
const SESSION_ROOM_PREFIX = "session:";
const CONNECTION_ROOM_PREFIX = "connections:";
const SOCKET_REVALIDATION_INTERVAL_MS = 30 * 1000;
const SOCKET_CONNECTION_ATTEMPTS_PER_MINUTE = 30;
const SOCKET_EVENT_RATE_LIMIT_MAX =
  Number(process.env.SOCKET_EVENT_RATE_LIMIT_MAX) || 60;
const SOCKET_EVENT_RATE_LIMIT_WINDOW_MS =
  Number(process.env.SOCKET_EVENT_RATE_LIMIT_WINDOW_MS) || 60 * 1000;
const SOCKET_CONNECTION_LIMIT_PER_USER =
  Number(process.env.SOCKET_CONNECTION_LIMIT_PER_USER) || 5;

const AUTH_COOKIE_NAMES = new Set<string>(Object.values(authCookieNames));

function hasAuthCookieHeader(cookieHeader: string | undefined): boolean {
  if (!cookieHeader) {
    return false;
  }

  return cookieHeader.split(";").some((cookie) => {
    const separatorIndex = cookie.indexOf("=");
    const cookieName = (
      separatorIndex < 0 ? cookie : cookie.slice(0, separatorIndex)
    ).trim();

    return AUTH_COOKIE_NAMES.has(cookieName);
  });
}

export async function isUserViewingConversation(
  userPublicId: UserPublicId,
  conversationPublicId: string,
): Promise<boolean> {
  if (viewingStateRedisService) {
    try {
      return await viewingStateRedisService.isConversationActive(
        userPublicId,
        conversationPublicId,
      );
    } catch (error) {
      logger.warn("[Socket] Falling back to socket presence lookup", {
        error,
        userPublicId,
        conversationPublicId,
      });
    }
  }

  if (!ioInstance) {
    return false;
  }

  const sockets = await ioInstance.in(userPublicId).fetchSockets();
  return sockets.some(
    (socket) => socket.data.activeConversationId === conversationPublicId,
  );
}

@injectable()
export class WebSocketServer {
  private io: SocketIOServer | null = null; // Stores the socket.io server instance
  private readonly socketAuthHandler: RequestHandler;
  private readonly sessionTimers = new WeakMap<SocketIOSocket, {
    expiry?: ReturnType<typeof setTimeout>;
    revalidation?: ReturnType<typeof setTimeout>;
  }>();
  private readonly presenceUpdates = new WeakMap<SocketIOSocket, Promise<void>>();
  private revocationRetryTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private adapterReady?: Promise<boolean>;
  private adapterSubscriber?: ReturnType<RedisService["clientInstance"]["duplicate"]>;

  constructor(
    @inject(RedisService) private readonly redisService: RedisService,
    @inject(TOKENS.Services.AuthMiddleware)
    private readonly authMiddlewareService: AuthMiddlewareService,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
    @inject(TOKENS.Repositories.Conversation)
    private readonly conversationRepository: ConversationRepository,
    @inject(TOKENS.Repositories.UserRead)
    private readonly userReadRepository: IUserReadRepository,
  ) {
    this.socketAuthHandler = authMiddlewareService.required();
    viewingStateRedisService = this.redisService;
  }

  /**
   * Initializes the WebSocket server with authentication and event handling.
   * @param {HttpServer} server - The HTTP server instance to attach the WebSocket server to.
   */
  initialize(server: HttpServer, trustProxy: TrustProxy = () => false): void {
    const allowedOrigins = getAllowedOrigins();

    this.io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ["GET", "POST"],
      },
      allowRequest: (req, callback) => {
        const origin =
          typeof req.headers.origin === "string"
            ? req.headers.origin
            : undefined;

        if (!origin) {
          // Node/non-browser clients may connect without Origin only when they
          // are not presenting ambient authentication cookies.
          if (hasAuthCookieHeader(req.headers.cookie)) {
            return callback(
              "Origin is required for cookie-authenticated sockets",
              false,
            );
          }

          void this.allowConnectionAttempt(req, trustProxy, "transport").then(
            (allowed) => callback(allowed ? null : "Too many connection attempts", allowed),
          );
          return;
        }

        if (!isAllowedOrigin(origin, allowedOrigins)) {
          return callback("Invalid origin", false);
        }
        void this.allowConnectionAttempt(req, trustProxy, "transport").then(
          (allowed) => callback(allowed ? null : "Too many connection attempts", allowed),
        );
      },
      transports: ["websocket", "polling"],
      path: "/socket.io",
      allowEIO3: true,
      maxHttpBufferSize: 16 * 1024,
    });
    ioInstance = this.io;
    this.stopped = false;
    registerSocketSessionValidator(this.io, (user) =>
      this.authMiddlewareService.assertActiveSession(user),
    );
    server.once("close", () => {
      this.stopped = true;
      if (this.revocationRetryTimer) clearTimeout(this.revocationRetryTimer);
      if (this.adapterSubscriber?.isOpen) {
        void this.adapterSubscriber.disconnect().catch(() => undefined);
      }
    });

    // Add Redis Adapter for horizontal scaling of Socket.io node processes
    void this.ensureRedisAdapter();
    void this.configureSessionRevocationListener();

    /**
     * Middleware to parse cookies from incoming socket requests.
     * This allows authentication tokens stored in cookies to be accessed in socket requests.
     */
    this.io.use((socket, next) => {
      // By casting cleanly to Request we can leverage Express middleware
      const req = socket.request as Request;
      cookieParser()(req, {} as any, () => {
        next();
      });
    });

    /**
     * Authentication middleware for WebSocket connections.
     * Uses bearer token authentication from the incoming cookie to verify and attach user data to the socket.
     */
    this.io.use(async (socket, next) => {
      try {
        const req = socket.request as Request;
        if (!(await this.allowConnectionAttempt(req, trustProxy, "namespace"))) {
          return next(Errors.authentication("Too many connection attempts"));
        }

        if (!(await this.ensureRedisAdapter())) {
          return next(Errors.authentication("Socket service is unavailable"));
        }

        // Allow token passed via Socket.IO auth payload as fallback
        const handshakeAuth = socket.handshake?.auth;
        if (
          handshakeAuth &&
          typeof handshakeAuth.token === "string" &&
          !req.headers.authorization
        ) {
          req.headers.authorization = `Bearer ${handshakeAuth.token}`;
          logger.info(
            "[Socket][Auth] Applied bearer token from handshake auth",
            { event: "websocket.auth.handshake_token_applied" },
          );
        }

        // Handle authentication using the bearer token strategy
        this.socketAuthHandler(req, {} as any, (error?: any) => {
          if (error) {
            logger.error("WebSocket authentication failed", {
              event: "websocket.auth.failed",
              error,
            });
            return next(Errors.authentication(error.message));
          }

          if (!req.decodedUser) {
            logger.error("Missing decoded user after authentication", {
              event: "websocket.auth.missing_decoded_user",
            });
            return next(Errors.authentication("Unauthorized"));
          }

          // Store user data in socket
          socket.data.user = req.decodedUser;
          socket.data.sessionId = req.decodedUser.sid;
          next();
        });
      } catch (error) {
        logger.error("WebSocket authentication error", {
          event: "websocket.auth.error",
          error,
        });
        next(Errors.authentication("Socket authentication failed"));
      }
    });

    /**
     * Handles new client connections to the WebSocket server.
     */
    this.io.on("connection", async (socket) => {
      socket.data.authenticated = false;
      this.sessionTimers.set(socket, {});
      socket.once("disconnect", () => {
        socket.data.authenticated = false;
        const timers = this.sessionTimers.get(socket);
        if (timers?.expiry) clearTimeout(timers.expiry);
        if (timers?.revalidation) clearTimeout(timers.revalidation);
        this.sessionTimers.delete(socket);
        this.enqueuePresenceUpdate(socket, () => this.handleConversationClosed(socket));
      });

      try {
        logger.info("WebSocket client connected", {
          event: "websocket.client.connected",
          socketId: socket.id,
        });

        // Join the user to their own private room

        const userPublicId = socket.data.user?.publicId || socket.data.user?.id;
        const sessionId = socket.data.sessionId;
        if (typeof sessionId !== "string" || !sessionId) {
          logger.warn("Socket connected without session identifier", {
            event: "websocket.client.missing_session",
            socketId: socket.id,
          });
          return socket.disconnect(true);
        }

        await socket.join(this.sessionRoom(sessionId));
        if (typeof userPublicId !== "string" || !userPublicId) {
          logger.warn("Socket connected without user data", {
            event: "websocket.client.missing_user",
            socketId: socket.id,
          });
          return socket.disconnect(true);
        }

        await socket.join(`${CONNECTION_ROOM_PREFIX}${userPublicId}`);
        if (!(await this.enforceConnectionLimit(socket, userPublicId))) {
          return;
        }

        await assertSocketSession(this.getIO(), socket.data.user as DecodedUser);
        if (!socket.connected) return;
        socket.data.authenticated = true;
        await socket.join(userPublicId);
        if (!socket.connected) return;
        this.disconnectAtSessionExpiry(socket);
        this.scheduleSessionRevalidation(socket);
        logger.info("WebSocket user joined own room", {
          event: "websocket.room.auto_joined",
          socketId: socket.id,
          userId: userPublicId,
        });

        // Send confirmation to client
        socket.emit(EventRegistry.socketServerEvents.joinResponse, {
          success: true,
          userId: userPublicId,
          message: "Automatically joined user room",
        });
        this.metricsService.recordSocketEventEmitted(
          EventRegistry.socketServerEvents.joinResponse,
          "socket",
        );

        let eventCount = 0;
        let eventWindowStartedAt = Date.now();
        socket.use((_event, next) => {
          const now = Date.now();
          if (now - eventWindowStartedAt >= SOCKET_EVENT_RATE_LIMIT_WINDOW_MS) {
            eventCount = 0;
            eventWindowStartedAt = now;
          }
          eventCount += 1;
          if (!socket.connected || eventCount > SOCKET_EVENT_RATE_LIMIT_MAX) {
            socket.disconnect(true);
            next(new Error("Too many socket events"));
            return;
          }
          void (async () => {
            if (!(await this.consumeSocketEventBudget(userPublicId))) {
              socket.disconnect(true);
              return next(new Error("Too many socket events"));
            }
            if (!(await validateSocketSession(this.getIO(), socket)) || !socket.connected) {
              return next(new Error("Socket session is invalid or expired"));
            }
            next();
          })().catch(() => {
            socket.disconnect(true);
            next(new Error("Socket authorization failed"));
          });
        });

        /**
         * Event listener for users manually joining a room.
         * This ensures the user is authenticated before joining.
         */
        socket.on(EventRegistry.socketClientEvents.join, (userId: string) => {
          if (!socket.data.user) {
            logger.warn("Unauthorized socket room join attempt", {
              event: "websocket.room.join_unauthorized",
              socketId: socket.id,
            });
            return socket.disconnect(); // Disconnect unauthorized users
          }

          if (!userId || typeof userId !== "string") {
            logger.warn("Invalid userId in socket join event", {
              event: "websocket.room.join_invalid_user_id",
              socketId: socket.id,
            });
            socket.emit(EventRegistry.socketServerEvents.joinResponse, {
              success: false,
              error: "Invalid userId",
            });
            this.metricsService.recordSocketEventEmitted(
              EventRegistry.socketServerEvents.joinResponse,
              "socket",
            );
            return;
          }

          logger.info("WebSocket room join requested", {
            event: "websocket.room.join_requested",
            socketId: socket.id,
          });
          const trimmedUserId = userId.trim();
          const authenticatedUserId =
            socket.data.user?.publicId || socket.data.user?.id;

          if (!authenticatedUserId || trimmedUserId !== authenticatedUserId) {
            logger.warn("Rejected socket room join for mismatched user", {
              requestedUserId: trimmedUserId,
              authenticatedUserId,
              socketId: socket.id,
            });
            socket.emit(EventRegistry.socketServerEvents.joinResponse, {
              success: false,
              error: "Forbidden room join",
            });
            this.metricsService.recordSocketEventEmitted(
              EventRegistry.socketServerEvents.joinResponse,
              "socket",
            );
            return;
          }

          socket.join(trimmedUserId);
          logger.info("WebSocket user joined room", {
            event: "websocket.room.joined",
            socketId: socket.id,
            userId: trimmedUserId,
            rooms: Array.from(socket.rooms),
          });

          // Emit success message
          socket.emit(EventRegistry.socketServerEvents.joinResponse, {
            success: true,
            userId: trimmedUserId,
          });
          this.metricsService.recordSocketEventEmitted(
            EventRegistry.socketServerEvents.joinResponse,
            "socket",
          );
        });

        // track when user opens a conversation (for suppressing notifications)
        socket.on(
          EventRegistry.socketClientEvents.conversationOpened,
          (conversationId: unknown) => {
            if (!isValidPublicId(conversationId)) {
              socket.disconnect(true);
              return;
            }
            this.enqueuePresenceUpdate(socket, () => this.handleConversationOpened(socket, conversationId));
          },
        );

        // track when user closes/leaves a conversation
        socket.on(
          EventRegistry.socketClientEvents.conversationClosed,
          (conversationId?: unknown) => {
            if (conversationId !== undefined && !isValidPublicId(conversationId)) {
              socket.disconnect(true);
              return;
            }
            this.enqueuePresenceUpdate(socket, () => this.handleConversationClosed(socket, conversationId));
          },
        );

      } catch (error) {
        logger.warn("WebSocket connection initialization failed", {
          event: "websocket.client.initialization_failed",
          error,
        });
        socket.disconnect(true);
      }
    });

    logger.info("WebSocket server initialized", {
      event: "websocket.server.initialized",
    });
  }

  private async ensureRedisAdapter(): Promise<boolean> {
    this.adapterReady ??= this.configureRedisAdapter();
    const ready = await this.adapterReady;
    if (!ready) this.adapterReady = undefined;
    return ready && this.adapterSubscriber?.isReady === true &&
      this.redisService.clientInstance.isReady;
  }

  private async configureRedisAdapter(): Promise<boolean> {
    const ready = await this.redisService.waitForConnection(1500);
    if (!ready || this.stopped) return false;

    const pubClient = this.redisService.clientInstance;
    const subClient = pubClient.duplicate();
    this.adapterSubscriber = subClient;
    subClient.on("error", (error) => {
      logger.warn("Socket Redis adapter connection error", { error });
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        subClient.connect(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Socket Redis adapter timed out"));
          }, 5000);
          timer.unref();
        }),
      ]);
      if (this.io && !this.stopped) {
        this.io.adapter(createAdapter(pubClient, subClient));
        return true;
      }
    } catch (error) {
      logger.warn("Socket Redis adapter unavailable; connections are disabled", { error });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (subClient.isOpen) await subClient.disconnect().catch(() => undefined);
    return false;
  }

  private async configureSessionRevocationListener(): Promise<void> {
    if (this.stopped) return;
    try {
      const subscribed = await this.redisService.subscribe<{ sid?: unknown; publicId?: unknown }>(
        [EventRegistry.redisChannels.sessionRevocations],
        (_channel, message) => {
          if (typeof message.publicId === "string" && message.publicId) {
            this.io?.local.in(`${CONNECTION_ROOM_PREFIX}${message.publicId}`).disconnectSockets(true);
          } else if (typeof message.sid === "string" && message.sid) {
            this.io?.local.in(this.sessionRoom(message.sid)).disconnectSockets(true);
          }
        },
        { timeoutMs: 1500 },
      );

      if (!subscribed) {
        logger.warn("Session-revocation socket listener not started", {
          event: "websocket.session_revocation_listener.unavailable",
        });
        this.retrySessionRevocationListener();
      }
    } catch (error) {
      logger.warn("Session-revocation socket listener failed", {
        event: "websocket.session_revocation_listener.failed",
        error,
      });
      this.retrySessionRevocationListener();
    }
  }

  private retrySessionRevocationListener(): void {
    if (this.stopped) return;
    this.revocationRetryTimer = setTimeout(() => {
      void this.configureSessionRevocationListener();
    }, 5000);
    this.revocationRetryTimer.unref();
  }

  private async allowConnectionAttempt(
    req: IncomingMessage,
    trustProxy: TrustProxy,
    phase: "transport" | "namespace",
  ): Promise<boolean> {
    try {
      return await this.redisService.consumeFixedWindowRateLimit(
        `socket:connection-rate-limit:${phase}:${getSocketIpRateLimitKey(req, trustProxy)}`,
        SOCKET_CONNECTION_ATTEMPTS_PER_MINUTE,
        60 * 1000,
      );
    } catch {
      return false;
    }
  }

  private sessionRoom(sid: string): string {
    return `${SESSION_ROOM_PREFIX}${sid}`;
  }

  private async enforceConnectionLimit(
    socket: SocketIOSocket,
    userPublicId: string,
  ): Promise<boolean> {
    if (!this.io) {
      socket.disconnect(true);
      return false;
    }

    try {
      const sockets = await this.io.in(`${CONNECTION_ROOM_PREFIX}${userPublicId}`).fetchSockets();
      if (sockets.length <= SOCKET_CONNECTION_LIMIT_PER_USER) {
        return true;
      }

      logger.warn("Socket connection limit exceeded", {
        event: "websocket.connection.rate_limited",
        socketId: socket.id,
        userId: userPublicId,
      });
      socket.disconnect(true);
      return false;
    } catch (error) {
      logger.error("Unable to enforce socket connection limit", {
        event: "websocket.connection.rate_limit_error",
        socketId: socket.id,
        userId: userPublicId,
        error,
      });
      socket.disconnect(true);
      return false;
    }
  }

  private async consumeSocketEventBudget(
    userPublicId: string,
  ): Promise<boolean> {
    try {
      return await this.redisService.consumeFixedWindowRateLimit(
        `socket:event-rate-limit:${userPublicId}`,
        SOCKET_EVENT_RATE_LIMIT_MAX,
        SOCKET_EVENT_RATE_LIMIT_WINDOW_MS,
      );
    } catch (error) {
      logger.error("Unable to enforce socket event rate limit", {
        event: "websocket.event.rate_limit_error",
        userId: userPublicId,
        error,
      });
      return false;
    }
  }

  private disconnectAtSessionExpiry(socket: SocketIOSocket): void {
    const exp = socket.data.user?.exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) {
      socket.disconnect(true);
      return;
    }

    const delay = exp * 1000 - Date.now();
    if (delay <= 0) {
      socket.disconnect(true);
      return;
    }

    const timers = this.sessionTimers.get(socket);
    if (!timers) return;
    timers.expiry = setTimeout(() => {
      socket.disconnect(true);
    }, Math.min(delay, 2 ** 31 - 1));
    timers.expiry.unref();
  }

  private scheduleSessionRevalidation(socket: SocketIOSocket): void {
    const timers = this.sessionTimers.get(socket);
    if (!timers || !socket.connected) return;
    timers.revalidation = setTimeout(() => {
      void validateSocketSession(this.getIO(), socket).then((valid) => {
        if (valid && socket.connected) this.scheduleSessionRevalidation(socket);
      }).catch(() => socket.disconnect(true));
    }, SOCKET_REVALIDATION_INTERVAL_MS);
    timers.revalidation.unref();
  }

  private enqueuePresenceUpdate(socket: SocketIOSocket, update: () => Promise<void>): void {
    const pending = (this.presenceUpdates.get(socket) ?? Promise.resolve())
      .then(update)
      .catch((error) => {
        logger.warn("Socket presence update failed", { error, socketId: socket.id });
        socket.disconnect(true);
      });
    this.presenceUpdates.set(socket, pending);
  }

  /**
   * Retrieves the initialized Socket.IO instance.
   * @returns {SocketIOServer} - The active WebSocket server instance.
   * @throws {Error} - If the WebSocket server has not been initialized.
   */
  getIO(): SocketIOServer {
    if (!this.io) {
      throw Errors.internal("WebSocket server is not initialized.");
    }
    return this.io;
  }

  private async handleConversationOpened(
    socket: SocketIOSocket,
    conversationId: string,
  ): Promise<void> {
    const userId = socket.data.user?.publicId;
    if (!socket.connected || !userId || !isValidPublicId(conversationId)) {
      return;
    }

    const { conversation } = await ensureConversationAccess(
      this.conversationRepository,
      this.userReadRepository,
      userId,
      asConversationPublicId(conversationId),
    );
    if (conversation.isClosed) throw Errors.forbidden("Conversation is closed");
    if (!(await validateSocketSession(this.getIO(), socket)) || !socket.connected) return;

    const previousConversationId = socket.data.activeConversationId;
    if (previousConversationId && previousConversationId !== conversationId) {
      await this.safeClearConversationPresence(
        userId,
        previousConversationId,
        socket.id,
      );
    }

    socket.data.activeConversationId = conversationId;

    try {
      const ttlSeconds = parseInt(
        process.env.ACTIVE_CONVERSATION_TTL_SECONDS || "90",
        10,
      );
      await this.redisService.markConversationPresence(
        userId,
        conversationId,
        socket.id,
        ttlSeconds,
      );
      logger.info("WebSocket conversation opened", {
        event: "websocket.conversation.opened",
        userId,
        conversationId,
        socketId: socket.id,
        ttlSeconds,
      });
    } catch (error) {
      logger.warn("[Socket] Failed to store conversation presence", {
        error,
        userId,
        conversationId,
        socketId: socket.id,
      });
    }
  }

  private async handleConversationClosed(
    socket: SocketIOSocket,
    conversationId?: string,
  ): Promise<void> {
    const userId = socket.data.user?.publicId;
    const activeConversationId = socket.data.activeConversationId;

    if (
      !userId ||
      !activeConversationId ||
      (conversationId && activeConversationId !== conversationId)
    ) {
      return;
    }

    await this.safeClearConversationPresence(
      userId,
      activeConversationId,
      socket.id,
    );
    delete socket.data.activeConversationId;

    logger.info(
      conversationId
        ? `User ${userId} closed conversation ${conversationId}`
        : `User ${userId} closed conversation`,
      {
        event: "websocket.conversation.closed",
        userId,
        conversationId,
        socketId: socket.id,
      },
    );
  }

  private async safeClearConversationPresence(
    userId: string,
    conversationId: string,
    socketId: string,
  ): Promise<void> {
    try {
      await this.redisService.clearConversationPresence(
        userId,
        conversationId,
        socketId,
      );
    } catch (error) {
      logger.warn("[Socket] Failed to clear conversation presence", {
        error,
        userId,
        conversationId,
        socketId,
      });
    }
  }
}
