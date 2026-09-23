import { randomUUID } from "node:crypto";
import { errorLogger } from "./winston";

export interface TerminalErrorContext {
  event: string;
  message: string;
  operation: string;
  worker?: string;
  messageType?: string;
  messageId?: string;
  attempt?: number;
  signal?: string;
  durationMs?: number;
  correlationId?: string;
  breadcrumbs?: unknown;
  operationId?: string;
}

export function logTerminalError(
  error: unknown,
  context: TerminalErrorContext,
): void {
  errorLogger.error({
    ...context,
    errorId: randomUUID(),
    operationId: context.operationId ?? randomUUID(),
    error,
    ...(process.env.RELEASE || process.env.GIT_SHA
      ? { release: process.env.RELEASE || process.env.GIT_SHA }
      : {}),
  });
}
