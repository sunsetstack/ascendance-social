import { Document } from "mongoose";

export interface IRequestLog extends Document {
  timestamp: Date;
  metadata: {
    userId?: string;
    correlationId?: string;
    clientRequestId?: string;
    clientBootId?: string;
    clientRequestAttempt?: number;
    axiosRetry?: boolean;
    previousClientRequestId?: string;
    causedByClientRequestId?: string;
    sessionId?: string;
    tokenFamilyId?: string;
    method: string;
    route: string;
    ip: string;
    origin?: string;
    referer?: string;
    userAgent?: string;
    statusCode: number;
    responseTimeMs: number;
    authState?: string;
    authSource?: string;
    authAction?: string;
    authEmail?: string;
    authUsername?: string;
    authHandle?: string;
    refreshRotated?: boolean;
  };
}
