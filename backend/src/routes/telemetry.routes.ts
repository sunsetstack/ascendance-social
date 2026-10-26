import { Router, Request, Response, RequestHandler, text } from "express";
import { injectable, inject } from "tsyringe";
import { TelemetryService } from "@/services/telemetry.service";
import { TOKENS } from "@/types/tokens";
import { logger } from "@/utils/winston";
import { feedTraceBatchSchema, telemetryBatchSchema } from "@/utils/schemas/telemetry.schemas";
import { isFeedTraceEnabled } from "@/services/feed/feed-trace";
import rateLimit from "express-rate-limit";
import {
  AuthMiddlewareService,
  adminRateLimit,
} from "../middleware/authentication.middleware";

@injectable()
export class TelemetryRoutes {
  private readonly router: Router;
  private readonly auth: RequestHandler;
  private readonly optionalAuth: RequestHandler;
  private readonly adminOnly: RequestHandler;

  constructor(
    @inject(TOKENS.Services.Telemetry)
    private readonly telemetryService: TelemetryService,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.router = Router();
    this.auth = authMiddlewareService.required();
    this.optionalAuth = authMiddlewareService.optional();
    this.adminOnly = authMiddlewareService.adminOnly();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.post("/feed-trace", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), this.optionalAuth, (req: Request, res: Response) => {
      if (!isFeedTraceEnabled()) { res.sendStatus(404); return; }
      const parsed = feedTraceBatchSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Invalid feed trace batch" }); return; }
      for (const item of parsed.data.events) {
        const { stack, ...fields } = item;
        const error = stack ? new Error(item.message ?? "Browser feed request failed") : undefined;
        if (error) error.stack = stack;
        logger.info("Browser feed trace", { ...fields, ...(error ? { error } : {}), traceSource: "browser", observedAt: item.at });
      }
      res.status(204).send();
    });
    // receive telemetry events from frontend
    // use text() middleware to handle sendBeacon which sends as text/plain
    this.router.post(
      "/",
      this.optionalAuth,
      text({ type: "*/*", limit: "100kb" }),
      async (req: Request, res: Response) => {
        try {
          // handle sendBeacon which might send as text/plain
          let body = req.body;
          if (typeof body === "string") {
            try {
              body = JSON.parse(body);
            } catch {
              res.status(400).json({ error: "invalid JSON" });
              return;
            }
          }

          const parsedBody = telemetryBatchSchema.safeParse(body);
          if (!parsedBody.success) {
            res.status(400).json({ error: "Invalid telemetry payload" });
            return;
          }

          const { events, visitor } = parsedBody.data;

          if (visitor && !req.decodedUser?.publicId) {
            req.visitorObservation = visitor;
          }

          // extract client info for context
          const clientInfo = {
            ip: req.ip || req.socket.remoteAddress,
            userAgent: req.get("User-Agent"),
            userId: req.decodedUser?.publicId,
          };

          await this.telemetryService.processEvents(events, clientInfo);

          res.status(204).send();
        } catch {
          // telemetry should fail silently from client perspective
          res.status(204).send();
        }
      },
    );

    // get aggregated metrics
    this.router.get(
      "/summary",
      this.auth,
      adminRateLimit,
      this.adminOnly,
      async (_req: Request, res: Response) => {
        try {
          const summary = await this.telemetryService.getSummary();
          res.json(summary);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to get summary";
          logger.error("Telemetry summary error", { error: message });
          res
            .status(500)
            .json({ error: "Failed to retrieve telemetry summary" });
        }
      },
    );
  }

  getRouter(): Router {
    return this.router;
  }
}
