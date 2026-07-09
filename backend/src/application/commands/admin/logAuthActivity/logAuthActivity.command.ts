import { ICommand } from "@/application/common/interfaces/command.interface";

export interface LogAuthActivityPayload {
  action: string;
  ip: string;
  origin?: string;
  referer?: string;
  userAgent?: string;
  route?: string;
  statusCode?: number;
  responseTimeMs?: number;
  correlationId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  authState?: string;
  authSource?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  userId?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  refreshRotated?: boolean;
}

export class LogAuthActivityCommand implements ICommand {
  readonly type = "LogAuthActivityCommand";

  constructor(public readonly payload: LogAuthActivityPayload) {}
}
