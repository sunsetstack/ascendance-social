import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { runWithRequestContext } from "@/runtime/request-context";

const MAX_CORRELATION_ID_LENGTH = 128;

const CLIENT_REQUEST_ID_HEADER = "x-client-request-id";
const CLIENT_BOOT_ID_HEADER = "x-client-boot-id";
const CLIENT_REQUEST_ATTEMPT_HEADER = "x-client-request-attempt";
const AXIOS_RETRY_HEADER = "x-axios-retry";
const PREVIOUS_CLIENT_REQUEST_ID_HEADER = "x-previous-client-request-id";
const CAUSED_BY_CLIENT_REQUEST_ID_HEADER = "x-caused-by-client-request-id";

declare module "express-serve-static-core" {
  interface Request {
    correlationId?: string;
    clientRequestId?: string;
    clientBootId?: string;
    clientRequestAttempt?: number;
    axiosRetry?: boolean;
    previousClientRequestId?: string;
    causedByClientRequestId?: string;
  }
}

function normalizeHeaderValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_CORRELATION_ID_LENGTH) {
    return undefined;
  }
  return trimmed;
}

function resolveCorrelationId(req: Request): string {
  const incoming = req.get("x-request-id") ?? req.get("x-correlation-id");
  const normalized = normalizeHeaderValue(incoming);

  if (normalized) {
    return normalized;
  }

  return randomUUID();
}

function resolveClientRequestId(req: Request): string | undefined {
  return normalizeHeaderValue(req.get(CLIENT_REQUEST_ID_HEADER) ?? undefined);
}

function resolveClientBootId(req: Request): string | undefined {
  return normalizeHeaderValue(req.get(CLIENT_BOOT_ID_HEADER) ?? undefined);
}

function resolveClientRequestAttempt(req: Request): number | undefined {
  const raw = normalizeHeaderValue(
    req.get(CLIENT_REQUEST_ATTEMPT_HEADER) ?? undefined,
  );
  if (!raw) {
    return undefined;
  }

  const attempt = Number(raw);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 100) {
    return undefined;
  }

  return attempt;
}

function resolveAxiosRetry(req: Request): boolean | undefined {
  const raw = normalizeHeaderValue(req.get(AXIOS_RETRY_HEADER) ?? undefined);
  if (!raw) {
    return undefined;
  }

  return raw.toLowerCase() === "true";
}

function resolvePreviousClientRequestId(req: Request): string | undefined {
  return normalizeHeaderValue(
    req.get(PREVIOUS_CLIENT_REQUEST_ID_HEADER) ?? undefined,
  );
}

function resolveCausedByClientRequestId(req: Request): string | undefined {
  return normalizeHeaderValue(
    req.get(CAUSED_BY_CLIENT_REQUEST_ID_HEADER) ?? undefined,
  );
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const correlationId = resolveCorrelationId(req);
  const clientRequestId = resolveClientRequestId(req);
  const clientBootId = resolveClientBootId(req);
  const clientRequestAttempt = resolveClientRequestAttempt(req);
  const axiosRetry = resolveAxiosRetry(req);
  const previousClientRequestId = resolvePreviousClientRequestId(req);
  const causedByClientRequestId = resolveCausedByClientRequestId(req);

  req.correlationId = correlationId;
  req.clientRequestId = clientRequestId;
  req.clientBootId = clientBootId;
  req.clientRequestAttempt = clientRequestAttempt;
  req.axiosRetry = axiosRetry;
  req.previousClientRequestId = previousClientRequestId;
  req.causedByClientRequestId = causedByClientRequestId;
  res.setHeader("X-Request-ID", correlationId);

  runWithRequestContext({ correlationId, clientRequestId, clientBootId }, () => {
    next();
  });
}
