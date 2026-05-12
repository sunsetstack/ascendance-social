import "reflect-metadata";
import express, { Application, Request } from "express";
import cookieParser from "cookie-parser";
import http from "http";
import cors from "cors";
import rateLimit from "express-rate-limit";

import helmet from "helmet";
import { injectable, inject } from "tsyringe";
import { UserRoutes } from "../routes/user.routes";
import { ImageRoutes } from "../routes/image.routes";
import { PostRoutes } from "../routes/post.routes";
import { CommentRoutes } from "../routes/comment.routes";
import { ErrorHandler } from "@/utils/errors";
import { SearchRoutes } from "../routes/search.routes";
import { AdminUserRoutes } from "../routes/admin.routes";
import {
  detailedRequestLogging,
  logBehaviour,
} from "../middleware/logMiddleware";
import { requestLogger } from "../middleware/requestLogger";
import { NotificationRoutes } from "../routes/notification.routes";
import { FeedRoutes } from "../routes/feed.routes";
import { FavoriteRoutes } from "../routes/favorite.routes";
import { MessagingRoutes } from "../routes/messaging.routes";
import path from "path";
import { logger } from "@/utils/winston";
import { MetricsRoutes } from "../routes/metrics.routes";
import { MetricsService } from "../metrics/metrics.service";
import { CommunityRoutes } from "../routes/community.routes";
import { TelemetryRoutes } from "../routes/telemetry.routes";
import { TOKENS } from "@/types/tokens";

@injectable()
export class Server {
  private app: Application;

  /**
   * Constructor for initializing the server with injected dependencies.
   * @param {UserRoutes} userRoutes - Routes for user-related endpoints.
   * @param {ImageRoutes} imageRoutes - Routes for legacy image endpoints.
   * @param {PostRoutes} postRoutes - Routes for post-related endpoints.
   * @param {CommentRoutes} commentRoutes - Routes for comment-related endpoints.
   * @param {SearchRoutes} searchRoutes - Routes for search-related endpoints.
   * @param {AdminUserRoutes} adminUserRoutes - Routes for admin-related endpoints.
   * @param {NotificationRoutes} notificationRoutes - Routes for notifications.
   * @param {FeedRoutes} feedRoutes - Routes for managing user feeds.
   * @param {FavoriteRoutes} favoriteRoutes - Routes for managing user favorites.
   * @param {MessagingRoutes} messagingRoutes - Routes for messaging features.
   */
  constructor(
    @inject(UserRoutes) private readonly userRoutes: UserRoutes,
    @inject(ImageRoutes) private readonly imageRoutes: ImageRoutes,
    @inject(PostRoutes) private readonly postRoutes: PostRoutes,
    @inject(CommentRoutes) private readonly commentRoutes: CommentRoutes,
    @inject(SearchRoutes) private readonly searchRoutes: SearchRoutes,
    @inject(AdminUserRoutes) private readonly adminUserRoutes: AdminUserRoutes,
    @inject(NotificationRoutes)
    private readonly notificationRoutes: NotificationRoutes,
    @inject(FeedRoutes) private readonly feedRoutes: FeedRoutes,
    @inject(FavoriteRoutes) private readonly favoriteRoutes: FavoriteRoutes,
    @inject(MessagingRoutes) private readonly messagingRoutes: MessagingRoutes,
    @inject(TOKENS.Routes.Metrics) private readonly metricsRoutes: MetricsRoutes,
    @inject(TOKENS.Services.Metrics) private readonly metricsService: MetricsService,
    @inject(CommunityRoutes) private readonly communityRoutes: CommunityRoutes,
    @inject(TOKENS.Routes.Telemetry)
    private readonly telemetryRoutes: TelemetryRoutes,
  ) {
    this.app = express();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling(); // Set up global error handling
  }

  /**
   * Initializes middleware for the Express app.
   */
  private initializeMiddlewares(): void {
    this.app.set("trust proxy", 1);
    this.app.use(helmet());

    // CORS setup
    const envAllowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || [];
    const allowedOrigins = [
      ...envAllowedOrigins,
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:80",
      "http://localhost",
      "http://192.168.56.1:5173",
      "http://192.168.1.10:5173",
      "http://172.28.144.1:5173",
      "http://172.18.128.1:5173",
    ];

    const corsOptions: cors.CorsOptions = {
      origin: (
        origin: string | undefined,
        callback: (err: Error | null, allow?: string | boolean) => void,
      ) => {
        if (!origin) {
          return callback(null, true);
        }
        if (allowedOrigins.includes(origin)) {
          return callback(null, origin);
        }
        logger.warn(`[Backend CORS] Blocked origin: ${origin}`);
        callback(
          new Error("Request from this origin is blocked by CORS policy"),
        );
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      exposedHeaders: ["Set-Cookie"],
      maxAge: 86400,
    };
    this.app.use(cors(corsOptions));
    this.app.options("*", cors(corsOptions));

    // Rate Limiting setup
    const getClientIp = (req: Request): string => {
      const stripPort = (raw: string): string => {
        const t = raw.trim();
        if (t.startsWith("[")) return t;
        const i = t.lastIndexOf(":");
        if (i === -1) return t;
        return /^\d{1,5}$/.test(t.slice(i + 1)) ? t.slice(0, i) : t;
      };

      const xff = req.headers["x-forwarded-for"];
      const forwardedIps =
        typeof xff === "string" && xff.trim()
          ? xff
              .split(",")
              .map((value) => stripPort(value))
              .filter((value) => value.length > 0)
          : [];
      const firstForwardedIp = forwardedIps[0];

      const cfIp = req.headers["cf-connecting-ip"];
      if (typeof cfIp === "string" && cfIp.trim()) {
        const normalizedCfIp = stripPort(cfIp);
        if (
          firstForwardedIp &&
          firstForwardedIp !== normalizedCfIp &&
          forwardedIps.includes(normalizedCfIp)
        ) {
          return firstForwardedIp;
        }
        return normalizedCfIp;
      }
      const trueClientIp = req.headers["true-client-ip"];
      if (typeof trueClientIp === "string" && trueClientIp.trim())
        return stripPort(trueClientIp);
      const xRealIp = req.headers["x-real-ip"];
      if (typeof xRealIp === "string" && xRealIp.trim())
        return stripPort(xRealIp);
      if (firstForwardedIp) return firstForwardedIp;
      return stripPort(req.ip || req.socket.remoteAddress || "unknown");
    };

    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 300,
      message: "Too many requests, please try again after 15 minutes",
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => getClientIp(req),
      skip: (req) => req.path === "/metrics" || req.path === "/health",
    });
    this.app.use(limiter);

    this.app.use(this.metricsService.httpMetricsMiddleware());
    this.app.use((req, res, next) => {
      logger.info(
        `[Backend] ${req.method} ${(req.originalUrl || req.url).split("?")[0]}`,
      );
      next();
    });

    this.app.use(cookieParser()); // Parsing cookies
    this.app.use(express.json({ limit: "1mb" })); // Parsing JSON request bodies
    this.app.use(express.urlencoded({ extended: true, limit: "1mb" })); // Handling URL-encoded payloads

    // Loggers
    this.app.use(logBehaviour); // Logs basic request/response info
    this.app.use(detailedRequestLogging); // Logs detailed request info
    this.app.use(requestLogger); // Logs requests to database for admin panel
  }

  /**
   * Registers API routes with the Express app.
   */
  private initializeRoutes() {
    const uploadsPath = path.join(process.cwd(), "uploads");
    logger.info("Serving static uploads from:", uploadsPath);
    this.app.use("/uploads", express.static(uploadsPath));

    this.app.use("/metrics", this.metricsRoutes.getRouter());
    this.app.use("/telemetry", this.telemetryRoutes.getRouter());

    // Add health check endpoint
    this.app.get("/health", (req, res) => {
      res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "backend",
      });
    });

    const apiRouter = express.Router();

    apiRouter.use("/users", this.userRoutes.getRouter());
    apiRouter.use("/images", this.imageRoutes.getRouter());
    apiRouter.use("/posts", this.postRoutes.getRouter());
    apiRouter.use("/", this.commentRoutes.getRouter()); // Comments are nested under images and users
    apiRouter.use("/search", this.searchRoutes.getRouter());
    apiRouter.use("/admin", this.adminUserRoutes.getRouter());
    apiRouter.use("/notifications", this.notificationRoutes.getRouter());
    apiRouter.use("/feed", this.feedRoutes.getRouter());
    apiRouter.use("/favorites", this.favoriteRoutes.getRouter());
    apiRouter.use("/messaging", this.messagingRoutes.getRouter());
    apiRouter.use("/communities", this.communityRoutes.getRouter());
    apiRouter.use("/telemetry", this.telemetryRoutes.getRouter());

    this.app.use("/api", apiRouter);

    // Catch-all 404 route
    this.app.use("*", (req, res) => {
      logger.info(`[Backend] 404 - Unmatched route: ${req.method} ${req.path}`);
      res.status(404).json({
        error: "Route not found",
      });
    });
  }

  /**
   * Sets up global error handling middleware.
   * Any unhandled errors will be caught and formatted using the ErrorHandler.
   */
  private initializeErrorHandling() {
    // Register metrics callback for error tracking
    ErrorHandler.setMetricsCallback(({ errorType, statusCode, endpoint }) => {
      this.metricsService.incrementCounter("errors_total", {
        error_type: errorType,
        status_code: statusCode.toString(),
        endpoint,
      });
    });

    this.app.use(ErrorHandler.handleError);
  }

  /**
   * Provides access to the Express application instance.
   * @returns {Application} - The Express app instance.
   */
  public getExpressApp(): Application {
    return this.app;
  }

  /**
   * Starts the HTTP server on the specified port.
   * @param {http.Server} server - The HTTP server instance.
   * @param {number} port - The port number to listen on.
   */
  public start(server: http.Server, port: number): void {
    server.timeout = 30000;
    server.headersTimeout = 31000;
    server.keepAliveTimeout = 65000;

    server.listen(port, () => {
      logger.info(`[Server] Server running on port ${port}`);
    });
  }
}
