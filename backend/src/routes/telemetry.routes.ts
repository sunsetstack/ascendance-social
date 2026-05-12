import { Router, Request, Response, text } from "express";
import { injectable, inject } from "tsyringe";
import { TelemetryService } from "@/services/telemetry.service";
import { TOKENS } from "@/types/tokens";
import { logger } from "@/utils/winston";
import { telemetryBatchSchema } from "@/utils/schemas/telemetry.schemas";
import {
  AuthFactory,
  adminRateLimit,
  enhancedAdminOnly,
} from "../middleware/authentication.middleware";

@injectable()
export class TelemetryRoutes {
  private readonly router: Router;

  constructor(
    @inject(TOKENS.Services.Telemetry)
    private readonly telemetryService: TelemetryService,
  ) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    const optionalAuth = AuthFactory.optionalBearerToken().handleOptional();

    // receive telemetry events from frontend
    // use text() middleware to handle sendBeacon which sends as text/plain
    this.router.post(
      "/",
      optionalAuth,
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

          const { events } = parsedBody.data;

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
    const auth = AuthFactory.bearerToken().handle();
    this.router.get(
      "/summary",
      auth,
      adminRateLimit,
      enhancedAdminOnly,
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
