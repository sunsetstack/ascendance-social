import { ICommand } from "@/application/common/interfaces/command.interface";
import type { ClientFingerprint, VisitorObservation } from "@/types";

export interface LogRequestPayload {
  method: string;
  route: string;
  ip: string;
  origin?: string;
  referer?: string;
  statusCode: number;
  responseTimeMs: number;
  aborted?: boolean;
  correlationId?: string;
  userId?: string;
  userAgent?: string;
  clientFingerprint?: ClientFingerprint;
  clientFingerprintSchemaVersion?: number;
  visitorObservation?: VisitorObservation;
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
