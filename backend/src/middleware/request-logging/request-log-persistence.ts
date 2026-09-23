import type { CommandBus } from "@/application/common/buses/command.bus";
import { LogRequestCommand } from "@/application/commands/admin/logRequest/logRequest.command";
import { isRequestLogPersistenceEnabled } from "@/config/requestLogConfig";
import { logger } from "@/utils/winston";
import type { CompletedRequestContext } from "./completed-request-context";

export function dispatchRequestLog(
  commandBus: CommandBus,
  context: CompletedRequestContext,
): void {
  if (!isRequestLogPersistenceEnabled()) {
    return;
  }

  const command = new LogRequestCommand({
    method: context.method,
    route: context.route,
    ip: context.ip,
    origin: context.origin,
    referer: context.referer,
    statusCode: context.statusCode,
    responseTimeMs: context.responseTimeMs,
    aborted: context.aborted,
    correlationId: context.correlationId,
    userId: context.userId,
    userAgent: context.userAgent,
    clientFingerprint: context.clientFingerprint,
    clientFingerprintSchemaVersion: context.clientFingerprintSchemaVersion,
    visitorObservation: context.visitorObservation,
    authState: context.authState,
    authSource: context.authSource,
    authAction: context.authAction,
    authEmail: context.authEmail,
    authUsername: context.authUsername,
    authHandle: context.authHandle,
    sessionId: context.sessionId,
    tokenFamilyId: context.tokenFamilyId,
    clientRequestId: context.clientRequestId,
    clientBootId: context.clientBootId,
    clientRequestAttempt: context.clientRequestAttempt,
    axiosRetry: context.axiosRetry,
    previousClientRequestId: context.previousClientRequestId,
    causedByClientRequestId: context.causedByClientRequestId,
    refreshRotated: context.refreshRotated,
  });

  void commandBus.dispatch(command).catch((error) => {
    logger.error("Failed to log request", {
      event: "admin.request_log.persist_failed",
      method: context.method,
      route: context.route,
      correlationId: context.correlationId,
      error,
    });
  });
}
