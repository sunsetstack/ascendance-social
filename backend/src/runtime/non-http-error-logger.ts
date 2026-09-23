import { randomUUID } from "node:crypto";
import {
  getErrorBreadcrumbSnapshot,
  getRequestContext,
  type ReadonlyRequestContextBreadcrumb,
} from "@/runtime/request-context";
import {
  redactSensitiveText,
  serializeError,
} from "@/utils/error-serialization";
import { errorLogger } from "@/utils/winston";

const MAX_METADATA_LENGTH = 256;
const MAX_BREADCRUMBS = 20;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

type NonHttpTerminalErrorContext = {
  message: string;
  event: string;
  operation: string;
  errorId?: string;
  operationId?: string;
  worker?: string;
  messageType?: string;
  messageId?: string;
  attempt?: number;
  signal?: string;
  durationMs?: number;
  traceId?: string;
  correlationId?: string;
  breadcrumbs?: readonly ReadonlyRequestContextBreadcrumb[];
};

function sanitizeMetadata(value: string | undefined): string | undefined {
  const sanitized =
    typeof value === "string"
      ? redactSensitiveText(value)
          .replace(/[\u0000-\u001f\u007f]/g, "")
          .slice(0, MAX_METADATA_LENGTH)
      : "";
  return sanitized || undefined;
}

function sanitizeIdentifier(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !value || value.length > 128) {
    return undefined;
  }

  const sanitized = redactSensitiveText(value);
  return sanitized && SAFE_IDENTIFIER_PATTERN.test(sanitized)
    ? sanitized
    : undefined;
}

function requiredMetadata(value: string): string {
  return sanitizeMetadata(value) ?? "[INVALID_METADATA]";
}

function getSafeErrorBreadcrumbSnapshot(
  error: unknown,
): readonly ReadonlyRequestContextBreadcrumb[] {
  try {
    const snapshot = getErrorBreadcrumbSnapshot(error);
    return snapshot ? [...snapshot] : [];
  } catch {
    return [];
  }
}

export function logNonHttpTerminalError(
  error: unknown,
  context: NonHttpTerminalErrorContext,
): string {
  const requestContext = getRequestContext();
  const errorId = sanitizeIdentifier(context.errorId) ?? randomUUID();
  const operationId = sanitizeIdentifier(context.operationId) ?? randomUUID();
  const correlationId = sanitizeIdentifier(
    context.correlationId ?? requestContext?.correlationId,
  );
  const messageId = sanitizeIdentifier(context.messageId);
  const traceId = sanitizeIdentifier(context.traceId);
  const worker = sanitizeMetadata(context.worker);
  const messageType = sanitizeMetadata(context.messageType);
  const signal = sanitizeMetadata(context.signal);
  const release = sanitizeMetadata(process.env.RELEASE || process.env.GIT_SHA);
  const attempt =
    Number.isSafeInteger(context.attempt) && (context.attempt ?? 0) > 0
      ? context.attempt
      : undefined;
  const durationMs =
    typeof context.durationMs === "number" &&
    Number.isFinite(context.durationMs) &&
    context.durationMs >= 0
      ? context.durationMs
      : undefined;
  const breadcrumbs = (
    context.breadcrumbs ?? [
      ...getSafeErrorBreadcrumbSnapshot(error),
      ...(requestContext?.breadcrumbs ?? []),
    ]
  ).slice(-MAX_BREADCRUMBS);

  errorLogger.error({
    message: requiredMetadata(context.message),
    event: requiredMetadata(context.event),
    operation: requiredMetadata(context.operation),
    operationId,
    errorId,
    ...(worker ? { worker } : {}),
    ...(messageType ? { messageType } : {}),
    ...(messageId ? { messageId } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(signal ? { signal } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(traceId ? { traceId } : {}),
    ...(correlationId ? { correlationId } : {}),
    env: requiredMetadata(process.env.NODE_ENV || "development"),
    ...(release ? { release } : {}),
    service: requiredMetadata(
      process.env.SERVICE_NAME || "ascendance-backend",
    ),
    ...(breadcrumbs.length ? { breadcrumbs: [...breadcrumbs] } : {}),
    error: serializeError(error),
  });

  return errorId;
}
