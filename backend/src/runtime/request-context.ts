import { AsyncLocalStorage } from "node:async_hooks";
import { redactSensitiveText } from "@/utils/error-serialization";

export type RequestContextBreadcrumbValue = string | number | boolean;

export type RequestContextBreadcrumb = {
  at: string;
  offsetMs?: number;
  event: string;
  data?: Record<string, RequestContextBreadcrumbValue>;
};

export type RequestContext = {
  correlationId: string;
  requestStartTime?: bigint;
  method?: string;
  requestPath?: string;
  userId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  clientIp?: string;
  userAgent?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  authSource?: string;
  breadcrumbs: RequestContextBreadcrumb[];
};

export type ReadonlyRequestContextBreadcrumb = Readonly<
  Omit<RequestContextBreadcrumb, "data">
> & {
  readonly data?: Readonly<Record<string, RequestContextBreadcrumbValue>>;
};

export type ReadonlyRequestContext = Readonly<
  Omit<RequestContext, "breadcrumbs">
> & {
  readonly breadcrumbs: readonly ReadonlyRequestContextBreadcrumb[];
};

export type RequestContextInput = Omit<RequestContext, "breadcrumbs">;

const MAX_BREADCRUMBS = 20;
const MAX_BREADCRUMB_DATA_ENTRIES = 8;
const MAX_BREADCRUMB_EVENT_LENGTH = 128;
const MAX_BREADCRUMB_KEY_LENGTH = 64;
const MAX_BREADCRUMB_STRING_LENGTH = 512;
const SENSITIVE_BREADCRUMB_KEYS = new Set([
  "access_token",
  "api_key",
  "authorization",
  "body",
  "client_ip",
  "cause",
  "cookie",
  "document",
  "email",
  "error_message",
  "filter",
  "handle",
  "ip",
  "ip_address",
  "jwt",
  "origin",
  "password",
  "password_hash",
  "passphrase",
  "payload",
  "pipeline",
  "query",
  "raw_body",
  "referrer",
  "refresh_token",
  "request_body",
  "response_body",
  "session_id",
  "source_ip",
  "stack",
  "secret",
  "token",
  "token_family_id",
  "update",
  "user_agent",
  "user_id",
  "user_public_id",
  "username",
]);

const ERROR_BREADCRUMB_SNAPSHOT = Symbol("errorBreadcrumbSnapshot");

type ErrorWithBreadcrumbSnapshot = Error & {
  [ERROR_BREADCRUMB_SNAPSHOT]?: readonly ReadonlyRequestContextBreadcrumb[];
};

export function attachErrorBreadcrumbSnapshot<T extends Error>(
  error: T,
  breadcrumbs: readonly ReadonlyRequestContextBreadcrumb[],
): T {
  const snapshot = Object.freeze(
    breadcrumbs.map((breadcrumb) =>
      Object.freeze({
        ...breadcrumb,
        ...(breadcrumb.data
          ? { data: Object.freeze({ ...breadcrumb.data }) }
          : {}),
      }),
    ),
  );
  Object.defineProperty(error, ERROR_BREADCRUMB_SNAPSHOT, {
    value: snapshot,
  });
  return error;
}

export function getErrorBreadcrumbSnapshot(
  error: unknown,
): readonly ReadonlyRequestContextBreadcrumb[] | undefined {
  if (!(error instanceof Error)) return undefined;
  return (error as ErrorWithBreadcrumbSnapshot)[ERROR_BREADCRUMB_SNAPSHOT];
}

const requestContextALS = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  context: RequestContextInput,
  work: () => T,
): T {
  return requestContextALS.run(
    {
      ...context,
      breadcrumbs: [],
    },
    work,
  );
}

function getMutableRequestContext(): RequestContext | undefined {
  return requestContextALS.getStore();
}

export function getRequestContext(): ReadonlyRequestContext | undefined {
  return getMutableRequestContext();
}

export function getCorrelationId(): string | undefined {
  return getRequestContext()?.correlationId;
}

export function getClientRequestId(): string | undefined {
  return getRequestContext()?.clientRequestId;
}

export function getClientBootId(): string | undefined {
  return getRequestContext()?.clientBootId;
}

export function setRequestContextUserId(userId: string): void {
  const context = getMutableRequestContext();
  if (!context) {
    return;
  }

  context.userId = userId;
}

export function setRequestContextAuthentication(input: {
  userId: string;
  sessionId?: string;
  tokenFamilyId?: string;
  authSource?: string;
}): void {
  const context = getMutableRequestContext();
  if (!context) {
    return;
  }

  context.userId = input.userId;
  context.sessionId = input.sessionId;
  context.tokenFamilyId = input.tokenFamilyId;
  context.authSource = input.authSource;
}

export function addRequestContextBreadcrumb(
  event: string,
  data?: Record<string, RequestContextBreadcrumbValue>,
): void {
  const context = getMutableRequestContext();
  const normalizedEvent = normalizeBreadcrumbEvent(event);
  if (!context || !normalizedEvent) {
    return;
  }

  const offsetMs = getBreadcrumbOffsetMs(context);
  const sanitizedData = sanitizeBreadcrumbData(data);
  const breadcrumb: RequestContextBreadcrumb = {
    at: new Date().toISOString(),
    event: normalizedEvent,
    ...(offsetMs === undefined ? {} : { offsetMs }),
    ...(sanitizedData ? { data: sanitizedData } : {}),
  };

  context.breadcrumbs.push(breadcrumb);
  if (context.breadcrumbs.length > MAX_BREADCRUMBS) {
    context.breadcrumbs.splice(0, context.breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

function normalizeBreadcrumbEvent(event: string): string | undefined {
  if (typeof event !== "string") {
    return undefined;
  }

  const normalized = event.trim();
  if (!normalized || normalized.length > MAX_BREADCRUMB_EVENT_LENGTH) {
    return undefined;
  }

  return normalized;
}

function getBreadcrumbOffsetMs(context: RequestContext): number | undefined {
  if (context.requestStartTime === undefined) {
    return undefined;
  }

  const offsetMs =
    Number(process.hrtime.bigint() - context.requestStartTime) / 1_000_000;
  return Number.isFinite(offsetMs) && offsetMs >= 0 ? offsetMs : undefined;
}

function sanitizeBreadcrumbData(
  data: Record<string, RequestContextBreadcrumbValue> | undefined,
): Record<string, RequestContextBreadcrumbValue> | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  let entries: [string, unknown][];
  try {
    entries = Object.entries(data);
  } catch {
    return undefined;
  }

  const sanitized = Object.create(null) as Record<
    string,
    RequestContextBreadcrumbValue
  >;
  let accepted = 0;

  for (const [rawKey, rawValue] of entries) {
    if (accepted >= MAX_BREADCRUMB_DATA_ENTRIES) {
      break;
    }

    const normalizedKey = normalizeBreadcrumbKey(rawKey);
    if (!normalizedKey || isSensitiveBreadcrumbKey(normalizedKey)) {
      continue;
    }
    const key = normalizedKey.slice(0, MAX_BREADCRUMB_KEY_LENGTH);

    if (typeof rawValue === "string") {
      sanitized[key] = redactSensitiveText(rawValue).slice(
        0,
        MAX_BREADCRUMB_STRING_LENGTH,
      );
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      sanitized[key] = rawValue;
    } else if (typeof rawValue === "boolean") {
      sanitized[key] = rawValue;
    } else {
      continue;
    }

    accepted += 1;
  }

  return accepted > 0 ? sanitized : undefined;
}

function normalizeBreadcrumbKey(rawKey: string): string {
  return rawKey
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

function isSensitiveBreadcrumbKey(key: string): boolean {
  for (const sensitiveKey of SENSITIVE_BREADCRUMB_KEYS) {
    if (key === sensitiveKey) {
      return true;
    }

    if (
      sensitiveKey !== "body" &&
      (key.startsWith(`${sensitiveKey}_`) ||
        key.endsWith(`_${sensitiveKey}`))
    ) {
      return true;
    }
  }

  return false;
}
