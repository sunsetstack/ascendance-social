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
  const { method, url } = req;

  behaviourLogger.info(`Request started: ${method} ${url}`, {
    correlationId: req.correlationId,
  });

  res.on("finish", () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    behaviourLogger.info(
      `Request completed: ${method} ${url} - Status: ${statusCode} - Duration: ${duration}ms`,
      {
        correlationId: req.correlationId,
      },
    );
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
    method: req.method,
    url: req.url.split("?")[0],
    correlationId: req.correlationId,
    params: Object.keys(req.params || {}).length > 0 ? req.params : undefined,
    query: Object.keys(req.query || {}).length > 0 ? req.query : undefined,
    ip: getClientIp(req),
    timestamp: new Date().toISOString(),
  };

  detailedRequestLogger.info("Detailed Request Log", logObject);

  res.on("finish", () => {
    detailedRequestLogger.info("Request completed", {
      method: req.method,
      url: req.url,
      correlationId: req.correlationId,
      status: res.statusCode,
      responseTime: Date.now() - startTime,
    });
  });

  next();
};
