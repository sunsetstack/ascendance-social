import { Request, Response, NextFunction } from "express";
import { behaviourLogger, detailedRequestLogger } from "@/utils/winston";
import { getClientIp } from "@/utils/request-ip";
declare module "express-serve-static-core" {
  interface Request {
    _startTime: number;
  }
}

// Middleware for logging behavior
export const logBehaviour = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const start = Date.now();
  const { method } = req;
  const route = (req.originalUrl || req.url).split("?")[0];

  behaviourLogger.debug("HTTP request started", {
    event: "http.request.started",
    correlationId: req.correlationId,
    method,
    route,
    userId: req.decodedUser?.publicId,
    ip: getClientIp(req),
    userAgent: req.get("user-agent"),
  });

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const { statusCode } = res;
    const level = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

    behaviourLogger.log(level, "HTTP request completed", {
      event: "http.request.completed",
      correlationId: req.correlationId,
      method,
      route,
      statusCode,
      durationMs,
      userId: req.decodedUser?.publicId,
      ip: getClientIp(req),
      userAgent: req.get("user-agent"),
    });
  });

  next();
};

export const detailedRequestLogging = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  req._startTime = Date.now();
  const startTime = req._startTime;

  const logObject = {
    event: "http.request.received",
    method: req.method,
    route: req.url.split("?")[0],
    correlationId: req.correlationId,
    params: Object.keys(req.params || {}).length > 0 ? req.params : undefined,
    query:
      process.env.NODE_ENV !== "production" &&
      Object.keys(req.query || {}).length > 0
        ? req.query
        : undefined,
    ip: getClientIp(req),
    timestamp: new Date().toISOString(),
  };

  detailedRequestLogger.debug("HTTP request received", logObject);

  res.on("finish", () => {
    detailedRequestLogger.debug("HTTP request completed", {
      event: "http.request.completed.detail",
      method: req.method,
      route: req.url.split("?")[0],
      correlationId: req.correlationId,
      statusCode: res.statusCode,
      durationMs: Date.now() - startTime,
    });
  });

  next();
};
