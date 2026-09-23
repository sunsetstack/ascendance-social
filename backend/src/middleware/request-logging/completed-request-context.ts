import type { Request, Response } from "express";
import { getCorrelationId } from "@/runtime/request-context";
import type { ClientFingerprint, VisitorObservation } from "@/types";
import { sanitizeObservedUrl } from "@/utils/client-evidence";
import { getClientIp } from "@/utils/request-ip";

const MAX_CLIENT_EVIDENCE_VALUE_LENGTH = 512;

export interface AuthLogMetadata {
  authAction?: string;
  userId?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  authState?: string;
  authSource?: string;
  refreshRotated?: boolean;
}

declare module "express-serve-static-core" {
  interface Request {
    authLogMetadata?: AuthLogMetadata;
    correlationId?: string;
    clientRequestId?: string;
    clientBootId?: string;
    clientRequestAttempt?: number;
    axiosRetry?: boolean;
    previousClientRequestId?: string;
    causedByClientRequestId?: string;
    authSource?: string;
    visitorObservation?: VisitorObservation;
  }
}

export interface CompletedRequestContext {
  method: string;
  route: string;
  ip: string;
  origin?: string;
  referer?: string;
  statusCode: number;
  responseTimeMs: number;
  aborted?: boolean;
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  clientFingerprint?: ClientFingerprint;
  clientFingerprintSchemaVersion?: number;
  visitorObservation?: VisitorObservation;
  authState: string;
  authSource: string;
  authAction?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  refreshRotated?: boolean;
}

export function getRequestRoute(req: Request): string {
  return (req.originalUrl || req.url).split("?")[0];
}

export function shouldSkipRequestLogging(route: string): boolean {
  return (
    route === "/health" ||
    route.startsWith("/metrics") ||
    route.startsWith("/telemetry") ||
    route.startsWith("/api/telemetry")
  );
}

export function buildCompletedRequestContext(
  req: Request,
  res: Response,
  route: string,
  startTime: number,
  options: { aborted?: boolean } = {},
): CompletedRequestContext {
  const authMetadata = req.authLogMetadata ?? {};
  const userId = authMetadata.userId ?? req.decodedUser?.publicId;
  const sessionId = authMetadata.sessionId ?? req.decodedUser?.sid;
  const clientFingerprint = buildClientFingerprint(req);

  return {
    method: req.method,
    route,
    ip: getClientIp(req),
    origin: sanitizeObservedUrl(req.get("origin"), "origin"),
    referer: sanitizeObservedUrl(req.get("referer"), "referer"),
    statusCode: options.aborted && !res.headersSent ? 499 : res.statusCode,
    responseTimeMs: Date.now() - startTime,
    aborted: options.aborted,
    correlationId: req.correlationId ?? getCorrelationId(),
    userId,
    userAgent: readBoundedHeader(req, "user-agent"),
    clientFingerprint,
    clientFingerprintSchemaVersion: clientFingerprint?.schemaVersion,
    visitorObservation: req.visitorObservation,
    authState: resolveAuthState(
      authMetadata.authState,
      userId,
      res.statusCode,
    ),
    authSource: resolveAuthSource(authMetadata.authSource, req, userId),
    authAction: authMetadata.authAction,
    authEmail: authMetadata.authEmail ?? req.decodedUser?.email,
    authUsername: authMetadata.authUsername ?? req.decodedUser?.username,
    authHandle: authMetadata.authHandle ?? req.decodedUser?.handle,
    sessionId,
    tokenFamilyId: authMetadata.tokenFamilyId ?? sessionId,
    clientRequestId: req.clientRequestId,
    clientBootId: req.clientBootId,
    clientRequestAttempt: req.clientRequestAttempt,
    axiosRetry: req.axiosRetry,
    previousClientRequestId: req.previousClientRequestId,
    causedByClientRequestId: req.causedByClientRequestId,
    refreshRotated: authMetadata.refreshRotated,
  };
}

function readBoundedHeader(req: Request, name: string): string | undefined {
  const value = req.get(name)?.trim();
  if (!value) {
    return undefined;
  }

  return value.slice(0, MAX_CLIENT_EVIDENCE_VALUE_LENGTH);
}

function buildClientFingerprint(req: Request): ClientFingerprint | undefined {
  const fingerprint: ClientFingerprint = {
    schemaVersion: 1,
    protocol: req.protocol === "http" || req.protocol === "https" ? req.protocol : undefined,
    protocolSource: "express_proxy_observed",
    accept: readBoundedHeader(req, "accept"),
    acceptEncoding: readBoundedHeader(req, "accept-encoding"),
    acceptLanguage: readBoundedHeader(req, "accept-language"),
    secChUa: readBoundedHeader(req, "sec-ch-ua"),
    secChUaMobile: readBoundedHeader(req, "sec-ch-ua-mobile"),
    secChUaPlatform: readBoundedHeader(req, "sec-ch-ua-platform"),
    secFetchDest: readBoundedHeader(req, "sec-fetch-dest"),
    secFetchMode: readBoundedHeader(req, "sec-fetch-mode"),
    secFetchSite: readBoundedHeader(req, "sec-fetch-site"),
    secFetchUser: readBoundedHeader(req, "sec-fetch-user"),
  };

  const hasObservedValue = Object.entries(fingerprint).some(
    ([key, value]) => key !== "schemaVersion" && key !== "protocolSource" && value,
  );
  return hasObservedValue ? fingerprint : undefined;
}

function resolveAuthState(
  configured: string | undefined,
  userId: string | undefined,
  statusCode: number,
): string {
  if (configured) {
    return configured;
  }

  if (userId) {
    return "authenticated";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "auth_failed";
  }

  return "anonymous";
}

function resolveAuthSource(
  configured: string | undefined,
  req: Request,
  userId: string | undefined,
): string {
  if (configured) {
    return configured;
  }

  if (req.authSource) {
    return req.authSource;
  }

  return userId ? "access_token" : "none";
}
