import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { LogRequestCommand } from "./logRequest.command";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { TOKENS } from "@/types/tokens";

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
      },
    });
  }
}
