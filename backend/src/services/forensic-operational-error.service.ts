import { randomUUID } from "node:crypto";
import { inject, injectable } from "tsyringe";
import type { IForensicOperationalErrorWriter } from "@/repositories/interfaces";
import { getRequestContext } from "@/runtime/request-context";
import type {
  ForensicErrorContext,
  ForensicSerializedError,
} from "@/types";
import { TOKENS } from "@/types/tokens";
import {
  redactSensitiveText,
  serializeError,
  type SerializedError,
} from "@/utils/error-serialization";
import { errorLogger } from "@/utils/winston";

const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_FORENSIC_STRING_LENGTH = 512;

export interface RecordForensicOperationalErrorInput {
  errorId: string;
  operation: string;
  severity?: "error" | "critical";
  statusCode?: number;
  occurredAt?: Date;
}

function sanitizeIdentifier(value: string | undefined): string | undefined {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value)) {
    return undefined;
  }

  return value;
}

function sanitizeString(
  value: string | undefined,
  maxLength = MAX_FORENSIC_STRING_LENGTH,
): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  const sanitized = redactSensitiveText(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, maxLength);
  return sanitized || undefined;
}

function sanitizeStatusCode(value: number | undefined): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

function allowlistedErrorContext(
  context: SerializedError["context"],
): ForensicErrorContext | undefined {
  if (!context) {
    return undefined;
  }

  const action = sanitizeIdentifier(
    typeof context.action === "string" ? context.action : undefined,
  );
  const resourceType = sanitizeIdentifier(
    typeof context.resourceType === "string"
      ? context.resourceType
      : undefined,
  );
  const postPublicId = sanitizeIdentifier(
    typeof context.postPublicId === "string"
      ? context.postPublicId
      : undefined,
  );
  const errorName = sanitizeString(
    typeof context.errorName === "string" ? context.errorName : undefined,
    128,
  );

  if (!action && !resourceType && !postPublicId && !errorName) {
    return undefined;
  }

  return {
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(postPublicId ? { postPublicId } : {}),
    ...(errorName ? { errorName } : {}),
  };
}

function toForensicSerializedError(
  serialized: SerializedError,
): ForensicSerializedError {
  const { context, cause, errors, ...structuralFields } = serialized;
  const allowlistedContext = allowlistedErrorContext(context);

  return {
    ...structuralFields,
    ...(allowlistedContext ? { context: allowlistedContext } : {}),
    ...(cause ? { cause: toForensicSerializedError(cause) } : {}),
    ...(errors
      ? { errors: errors.map((child) => toForensicSerializedError(child)) }
      : {}),
  };
}

@injectable()
export class ForensicOperationalErrorService {
  constructor(
    @inject(TOKENS.Repositories.ForensicOperationalErrorWriter)
    private readonly forensicWriter: IForensicOperationalErrorWriter,
  ) {}

  async record(
    error: unknown,
    input: RecordForensicOperationalErrorInput,
  ): Promise<void> {
    const errorId = sanitizeIdentifier(input.errorId) ?? randomUUID();

    try {
      const requestContext = getRequestContext();
      const serializedError = toForensicSerializedError(serializeError(error));
      const eventId = randomUUID();
      const userId = sanitizeIdentifier(requestContext?.userId);
      const statusCode = sanitizeStatusCode(
        input.statusCode ?? serializedError.statusCode,
      );
      const operation = sanitizeString(input.operation) ?? "unknown";
      const severity = input.severity === "critical" ? "critical" : "error";
      const clientRequestAttempt =
        Number.isSafeInteger(requestContext?.clientRequestAttempt) &&
        (requestContext?.clientRequestAttempt ?? 0) >= 1 &&
        (requestContext?.clientRequestAttempt ?? 0) <= 100
          ? requestContext?.clientRequestAttempt
          : undefined;
      const hasRequestContext = Boolean(
        requestContext?.method || requestContext?.requestPath,
      );

      await this.forensicWriter.append({
        schemaVersion: 1,
        eventId,
        errorId,
        eventType: "operational.error",
        occurredAt: input.occurredAt ?? new Date(),
        severity,
        operation,
        actor: {
          type: userId
            ? "user"
            : hasRequestContext
              ? "anonymous"
              : "system",
          ...(userId ? { userId } : {}),
        },
        request: {
          ...(requestContext?.correlationId
            ? { correlationId: sanitizeIdentifier(requestContext.correlationId) }
            : {}),
          ...(requestContext?.clientRequestId
            ? { clientRequestId: sanitizeIdentifier(requestContext.clientRequestId) }
            : {}),
          ...(requestContext?.clientBootId
            ? { clientBootId: sanitizeIdentifier(requestContext.clientBootId) }
            : {}),
          ...(clientRequestAttempt !== undefined
            ? { clientRequestAttempt }
            : {}),
          ...(requestContext?.previousClientRequestId
            ? {
                previousClientRequestId: sanitizeIdentifier(
                  requestContext.previousClientRequestId,
                ),
              }
            : {}),
          ...(requestContext?.causedByClientRequestId
            ? {
                causedByClientRequestId: sanitizeIdentifier(
                  requestContext.causedByClientRequestId,
                ),
              }
            : {}),
          ...(requestContext?.method
            ? { method: sanitizeString(requestContext.method, 16) }
            : {}),
          ...(requestContext?.requestPath
            ? { route: sanitizeString(requestContext.requestPath, 2_048) }
            : {}),
          ...(statusCode !== undefined ? { statusCode } : {}),
          ...(requestContext?.clientIp
            ? { ip: sanitizeString(requestContext.clientIp, 128) }
            : {}),
          ...(requestContext?.userAgent
            ? { userAgent: sanitizeString(requestContext.userAgent) }
            : {}),
        },
        session: {
          ...(requestContext?.sessionId
            ? { sessionId: sanitizeString(requestContext.sessionId) }
            : {}),
          ...(requestContext?.tokenFamilyId
            ? { tokenFamilyId: sanitizeString(requestContext.tokenFamilyId) }
            : {}),
          ...(requestContext?.authSource
            ? { authSource: sanitizeString(requestContext.authSource, 64) }
            : {}),
        },
        error: serializedError,
      });
    } catch (writerError) {
      errorLogger.error({
        message: "Forensic operational error write failed",
        event: "forensic_operational_error.write_failed",
        errorId,
        error: serializeError(writerError),
      });
    }
  }
}
