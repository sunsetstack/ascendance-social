import { inject, injectable } from "tsyringe";
import { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import { LogRequestCommand } from "./logRequest.command";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import type { IUserWriteRepository } from "@/repositories/interfaces/IUserWriteRepository";
import { TOKENS } from "@/types/tokens";
import { asUserPublicId } from "@/types/branded";

@injectable()
export class LogRequestCommandHandler implements ICommandHandler<
  LogRequestCommand,
  void
> {
  constructor(
    @inject(TOKENS.Repositories.RequestLog)
    private readonly requestLogRepository: RequestLogRepository,
    @inject(TOKENS.Repositories.UserWrite)
    private readonly userWriteRepository: IUserWriteRepository,
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
      correlationId,
      userId,
      userAgent,
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

    const tasks: Promise<any>[] = [
      this.requestLogRepository.create({
        timestamp: new Date(),
        metadata: {
          method,
          route,
          ip,
          origin,
          referer,
          statusCode,
          responseTimeMs,
          correlationId,
          userId,
          userAgent,
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
      }),
    ];

    if (userId) {
      tasks.push(
        this.userWriteRepository.updateByPublicId(asUserPublicId(userId), {
          $set: { lastActive: new Date(), lastIp: ip },
        }),
      );
    }

    await Promise.allSettled(tasks);
  }
}
