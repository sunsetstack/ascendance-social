import { Request } from "express";
import { Server as HttpServer } from "http";
import { AuthFactory } from "../middleware/authentication.middleware";
import { Server as SocketIOServer } from "socket.io";
import { injectable, inject } from "tsyringe";
import cookieParser from "cookie-parser";
import { Errors } from "@/utils/errors";
import { logger } from "@/utils/winston";
import { createAdapter } from "@socket.io/redis-adapter";
import { RedisService } from "@/services/redis.service";

let ioInstance: SocketIOServer | null = null;

export async function isUserViewingConversation(
  userPublicId: string,
  conversationPublicId: string,
): Promise<boolean> {
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

  constructor(
    @inject(RedisService) private readonly redisService: RedisService,
  ) {}

  /**
   * Initializes the WebSocket server with authentication and event handling.
   * @param {HttpServer} server - The HTTP server instance to attach the WebSocket server to.
   */
  initialize(server: HttpServer): void {
    const envOrigins =
      process.env.ALLOWED_ORIGINS?.split(/[,\s]+/).filter(Boolean) || [];
    const defaultOrigins = [
      "http://localhost:5173", // Vite dev
      "http://localhost:80", // Nginx in Docker
      "http://localhost", // Browser default
      "http://localhost:8000", // API Gateway
    ];
    const allowedOrigins = [...defaultOrigins, ...envOrigins];

    this.io = new SocketIOServer(server, {
      cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
      path: "/socket.io",
      allowEIO3: true, // Allow older clients if needed
    });
    ioInstance = this.io;

    // Add Redis Adapter for horizontal scaling of Socket.io node processes
    const pubClient = this.redisService.clientInstance;
    const subClient = pubClient.duplicate();
    subClient
      .connect()
      .then(() => {
        if (this.io) {
          this.io.adapter(createAdapter(pubClient, subClient));
          logger.info(
            "[Websocket][Config] Redis adapter for Socket.io configured successfully.",
          );
        }
      })
      .catch((err) => {
        logger.error(
          "Failed to connect Redis subClient for Socket.io adapter",
          err,
        );
      });

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
        if (handshakeAuth && typeof handshakeAuth.token === "string" && !req.headers.authorization) {
          req.headers.authorization = `Bearer ${handshakeAuth.token}`;
          logger.info(
            "[Socket][Auth] Applied bearer token from handshake auth",
          );
        }

        // Handle authentication using the bearer token strategy
        AuthFactory.bearerToken().handle()(req, {} as any, (error?: any) => {
          if (error) {
            logger.error("Auth error:", error);
            return next(Errors.authentication(error.message));
          }

          if (!req.decodedUser) {
            logger.error("Missing decoded user after authentication");
            return next(Errors.authentication("Unauthorized"));
          }

          // Store user data in socket
          socket.data.user = req.decodedUser;
          next();
        });
      } catch (error) {
        logger.error("WebSocket auth error:", error);
        next(Errors.authentication("Socket authentication failed"));
      }
    });

    /**
     * Handles new client connections to the WebSocket server.
     */
    this.io.on("connection", (socket) => {
      logger.info("New client connected:", socket.id);

      // Join the user to their own private room

      const userPublicId = socket.data.user?.publicId || socket.data.user?.id;
      if (userPublicId) {
        socket.join(userPublicId);
        logger.info(`User ${userPublicId} joined their room automatically`);

        // Send confirmation to client
        socket.emit("join_response", {
          success: true,
          userId: userPublicId,
          message: "Automatically joined user room",
        });
      } else {
        logger.warn("Socket connected without user data:", socket.id);
      }

      /**
       * Event listener for users manually joining a room.
       * This ensures the user is authenticated before joining.
       */
      socket.on("join", (userId: string) => {
        if (!socket.data.user) {
          logger.warn("Unauthorized join attempt. Disconnecting socket.");
          return socket.disconnect(); // Disconnect unauthorized users
        }

        if (!userId || typeof userId !== "string") {
          logger.warn("Invalid userId in join event:", userId);
          socket.emit("join_response", {
            success: false,
            error: "Invalid userId",
          });
          return;
        }

        logger.info(`User join room request received`);
        const trimmedUserId = userId.trim();
        const authenticatedUserId =
          socket.data.user?.publicId || socket.data.user?.id;

        if (!authenticatedUserId || trimmedUserId !== authenticatedUserId) {
          logger.warn("Rejected socket room join for mismatched user", {
            requestedUserId: trimmedUserId,
            authenticatedUserId,
            socketId: socket.id,
          });
          socket.emit("join_response", {
            success: false,
            error: "Forbidden room join",
          });
          return;
        }

        logger.info(`Received a join event with data: ${trimmedUserId}`);
        socket.join(trimmedUserId);
        logger.info(`User ${trimmedUserId} joined their room`);
        logger.info(`Socket rooms:`, Array.from(socket.rooms));

        // Emit success message
        socket.emit("join_response", {
          success: true,
          userId: trimmedUserId,
        });
      });

      // track when user opens a conversation (for suppressing notifications)
      socket.on("conversation_opened", (conversationId: string) => {
        const userId = socket.data.user?.publicId;
        if (userId && conversationId) {
          socket.data.activeConversationId = conversationId;
          logger.info(`User ${userId} opened conversation ${conversationId}`);
        }
      });

      // track when user closes/leaves a conversation
      socket.on("conversation_closed", (conversationId?: string) => {
        const userId = socket.data.user?.publicId;
        if (
          userId &&
          (!conversationId ||
            socket.data.activeConversationId === conversationId)
        ) {
          delete socket.data.activeConversationId;
          logger.info(
            conversationId
              ? `User ${userId} closed conversation ${conversationId}`
              : `User ${userId} closed conversation`,
          );
        }
      });

      socket.on("disconnect", () => {
        delete socket.data.activeConversationId;
        logger.info("Client disconnected:", socket.id);
      });
    });

    logger.info("WebSocket server initialized.");
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
}
