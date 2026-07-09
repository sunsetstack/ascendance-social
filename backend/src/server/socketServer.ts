import { UserPublicId } from "@/types/branded";
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
import { getAllowedOrigins } from "@/config/corsConfig";
import { TOKENS } from "@/types/tokens";
import { EventRegistry } from "@/application/common/events/event-registry";
import { MetricsService } from "@/metrics/metrics.service";

let ioInstance: SocketIOServer | null = null;
let viewingStateRedisService: RedisService | null = null;

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

  constructor(
    @inject(RedisService) private readonly redisService: RedisService,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
  ) {
    this.socketAuthHandler = authMiddlewareService.required();
    viewingStateRedisService = this.redisService;
  }

  /**
   * Initializes the WebSocket server with authentication and event handling.
   * @param {HttpServer} server - The HTTP server instance to attach the WebSocket server to.
   */
  initialize(server: HttpServer): void {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: getAllowedOrigins(),
        credentials: true,
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
      path: "/socket.io",
      allowEIO3: true, // Allow older clients if needed
    });
    ioInstance = this.io;

    // Add Redis Adapter for horizontal scaling of Socket.io node processes
    void this.configureRedisAdapter();

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
    this.io.on("connection", (socket) => {
      logger.info("WebSocket client connected", {
        event: "websocket.client.connected",
        socketId: socket.id,
      });

      // Join the user to their own private room

      const userPublicId = socket.data.user?.publicId || socket.data.user?.id;
      if (userPublicId) {
        socket.join(userPublicId);
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
      } else {
        logger.warn("Socket connected without user data", {
          event: "websocket.client.missing_user",
          socketId: socket.id,
        });
      }

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
      socket.on(EventRegistry.socketClientEvents.conversationOpened, (conversationId: string) => {
        void this.handleConversationOpened(socket, conversationId);
      });

      // track when user closes/leaves a conversation
      socket.on(EventRegistry.socketClientEvents.conversationClosed, (conversationId?: string) => {
        void this.handleConversationClosed(socket, conversationId);
      });

      socket.on("disconnect", () => {
        void this.handleConversationClosed(socket);
        logger.info("WebSocket client disconnected", {
          event: "websocket.client.disconnected",
          socketId: socket.id,
        });
      });
    });

    logger.info("WebSocket server initialized", {
      event: "websocket.server.initialized",
    });
  }

  private async configureRedisAdapter(): Promise<void> {
    const ready = await this.redisService.waitForConnection(1500);
    if (!ready) {
      logger.warn(
        "[Websocket][Config] Redis unavailable; running Socket.io without Redis adapter.",
        { event: "websocket.redis_adapter.unavailable" },
      );
      return;
    }

    const pubClient = this.redisService.clientInstance;
    const subClient = pubClient.duplicate();

    try {
      await subClient.connect();
      if (this.io) {
        this.io.adapter(createAdapter(pubClient, subClient));
        logger.info(
          "[Websocket][Config] Redis adapter for Socket.io configured successfully.",
          { event: "websocket.redis_adapter.configured" },
        );
      }
    } catch (error) {
      logger.warn(
        "[Websocket][Config] Redis adapter unavailable; continuing without it.",
        { error },
      );
    }
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
    if (!userId || !conversationId) {
      return;
    }

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
