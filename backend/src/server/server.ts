import "reflect-metadata";
import express, { Application } from "express";
import compression from "compression";
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
import { correlationIdMiddleware } from "../middleware/correlationId.middleware";
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
import { buildCorsOptions } from "@/config/corsConfig";
import { getClientIp } from "@/utils/request-ip";
import { getRateLimitStoreOptions } from "@/config/rateLimit";
import { csrfOriginMiddleware } from "@/middleware/csrf-origin.middleware";

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
    @inject(TOKENS.Routes.Metrics)
    private readonly metricsRoutes: MetricsRoutes,
    @inject(TOKENS.Services.Metrics)
    private readonly metricsService: MetricsService,
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
    this.app.set("trust proxy", this.resolveTrustProxySetting());
    this.app.use(correlationIdMiddleware);
    this.app.use(helmet());

    const corsOptions = buildCorsOptions();
    this.app.use(cors(corsOptions));
    this.app.options("*", cors(corsOptions));

    this.app.use(compression());

    // Rate Limiting setup
    const limiter = rateLimit({
      ...getRateLimitStoreOptions("global"),
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 300,
      message: "Too many requests, please try again after 15 minutes",
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => getClientIp(req),
      skip: (req) => req.path === "/metrics" || req.path === "/health",
    });
    this.app.use(limiter);

    this.app.use(this.metricsService.httpMetricsMiddleware());

    this.app.use(cookieParser()); // Parsing cookies
    this.app.use(csrfOriginMiddleware);
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
    logger.info("Serving static uploads", {
      event: "static_uploads.enabled",
      uploadsPath,
    });
    this.app.use("/uploads", express.static(uploadsPath));

    this.app.use("/metrics", this.metricsRoutes.getRouter());

    // Add health check endpoint
    this.app.get("/health", (_req, res) => {
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
      logger.debug("Unmatched route", {
        method: req.method,
        path: req.path,
      });
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
      logger.info("HTTP server started", {
        event: "http.server.started",
        port,
      });
    });
  }

  private resolveTrustProxySetting(): boolean | number | string {
    const configuredValue = process.env.TRUST_PROXY;
    if (!configuredValue) {
      return false;
    }

    if (configuredValue === "true") {
      return true;
    }

    if (configuredValue === "false") {
      return false;
    }

    const numericValue = Number(configuredValue);
    if (Number.isInteger(numericValue)) {
      return numericValue;
    }

    return configuredValue;
  }
}
