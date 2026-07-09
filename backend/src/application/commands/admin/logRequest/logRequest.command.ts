import { ICommand } from "@/application/common/interfaces/command.interface";

export interface LogRequestPayload {
  method: string;
  route: string;
  ip: string;
  origin?: string;
  referer?: string;
  statusCode: number;
  responseTimeMs: number;
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  authState?: string;
  authSource?: string;
  authAction?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  refreshRotated?: boolean;
}

export class LogRequestCommand implements ICommand {
  readonly type = "LogRequestCommand";

  constructor(public readonly payload: LogRequestPayload) {}
}
