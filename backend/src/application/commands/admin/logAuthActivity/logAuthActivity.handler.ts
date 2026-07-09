import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { LogAuthActivityCommand } from "./logAuthActivity.command";
import { AuthActivityLogRepository } from "@/repositories/authActivityLog.repository";
import { TOKENS } from "@/types/tokens";

@injectable()
export class LogAuthActivityCommandHandler implements ICommandHandler<
  LogAuthActivityCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.AuthActivityLog)
    private readonly authActivityLogRepository: AuthActivityLogRepository,
  ) {}

  async execute(command: LogAuthActivityCommand): Promise<void> {
    const {
      action,
      ip,
      origin,
      referer,
      userAgent,
      route,
      statusCode,
      responseTimeMs,
      correlationId,
      clientRequestId,
      clientBootId,
      clientRequestAttempt,
      axiosRetry,
      previousClientRequestId,
      causedByClientRequestId,
      authState,
      authSource,
      sessionId,
      tokenFamilyId,
      userId,
      authEmail,
      authUsername,
      authHandle,
      refreshRotated,
    } = command.payload;

    await this.authActivityLogRepository.create({
      timestamp: new Date(),
      metadata: {
        action,
        ip,
        origin,
        referer,
        userAgent,
        route,
        statusCode,
        responseTimeMs,
        correlationId,
        clientRequestId,
        clientBootId,
        clientRequestAttempt,
        axiosRetry,
        previousClientRequestId,
        causedByClientRequestId,
        authState,
        authSource,
        sessionId,
        tokenFamilyId,
        userId,
        authEmail,
        authUsername,
        authHandle,
        refreshRotated,
      },
    });
  }
}
