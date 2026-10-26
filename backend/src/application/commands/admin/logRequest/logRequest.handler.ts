import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { LogRequestCommand } from "./logRequest.command";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { TOKENS } from "@/types/tokens";

function redactMessagingLocation(value: string): string;
function redactMessagingLocation(value: string | undefined): string | undefined;
function redactMessagingLocation(
  value: string | undefined,
): string | undefined {
  return value
    ?.replace(
      /(\/api\/messaging\/(?:conversations|messages)\/)[0-9a-f-]{36}/gi,
      "$1:redacted",
    )
    .replace(/([?&]conversation=)[^&#]*/gi, "$1redacted");
}

@injectable()
export class LogRequestCommandHandler implements ICommandHandler<
  LogRequestCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.RequestLog)
    private readonly requestLogRepository: RequestLogRepository,
  ) {}

  async execute(command: LogRequestCommand): Promise<void> {
    const {
      method,
      route,
      ip,
      origin,
      referer,
      statusCode,
      responseTimeMs,
      aborted,
      correlationId,
      userId,
      userAgent,
      clientFingerprint,
      clientFingerprintSchemaVersion,
      visitorObservation,
      authState,
      authSource,
      authAction,
      authEmail,
      authUsername,
      authHandle,
      sessionId,
      tokenFamilyId,
      clientRequestId,
      clientBootId,
      clientRequestAttempt,
      axiosRetry,
      previousClientRequestId,
      causedByClientRequestId,
      refreshRotated,
    } = command.payload;

    await this.requestLogRepository.create({
      timestamp: new Date(),
      metadata: {
        method,
        route: redactMessagingLocation(route),
        ip,
        origin,
        referer: redactMessagingLocation(referer),
        statusCode,
        responseTimeMs,
        aborted,
        correlationId,
        userId,
        userAgent,
        clientFingerprint,
        clientFingerprintSchemaVersion,
        visitorObservation: visitorObservation
          ? {
              ...visitorObservation,
              path: redactMessagingLocation(visitorObservation.path),
              referrer: redactMessagingLocation(visitorObservation.referrer),
            }
          : undefined,
        authState,
        authSource,
        authAction,
        authEmail,
        authUsername,
        authHandle,
        sessionId,
        tokenFamilyId,
        clientRequestId,
        clientBootId,
        clientRequestAttempt,
        axiosRetry,
        previousClientRequestId,
        causedByClientRequestId,
        refreshRotated,
      },
    });
  }
}
