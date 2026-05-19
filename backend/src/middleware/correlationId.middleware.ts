import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "@/runtime/request-context";

const MAX_CORRELATION_ID_LENGTH = 128;

declare module "express-serve-static-core" {
  interface Request {
    correlationId?: string;
  }
}

function resolveCorrelationId(req: Request): string {
  const incoming = req.get("x-request-id") ?? req.get("x-correlation-id");
  const normalized = incoming?.trim();

  if (normalized && normalized.length <= MAX_CORRELATION_ID_LENGTH) {
    return normalized;
  }

  return randomUUID();
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId = resolveCorrelationId(req);

  req.correlationId = correlationId;
  res.setHeader("X-Request-ID", correlationId);

  runWithRequestContext({ correlationId }, () => {
    next();
  });
}
