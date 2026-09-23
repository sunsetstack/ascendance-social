import { Document } from "mongoose";
import type { ClientFingerprint } from "../customRequestLog/clientEvidence.types";

export interface IAuthActivityLog extends Document {
  timestamp: Date;
  metadata: {
    action: string;
    correlationId?: string;
    clientRequestId?: string;
    clientBootId?: string;
    clientRequestAttempt?: number;
    axiosRetry?: boolean;
    previousClientRequestId?: string;
    causedByClientRequestId?: string;
    sessionId?: string;
    tokenFamilyId?: string;
    userId?: string;
    authEmail?: string;
    authUsername?: string;
    authHandle?: string;
    ip: string;
    origin?: string;
    referer?: string;
    userAgent?: string;
    clientFingerprint?: ClientFingerprint;
    clientFingerprintSchemaVersion?: number;
    aborted?: boolean;
    route?: string;
    statusCode?: number;
    responseTimeMs?: number;
    authState?: string;
    authSource?: string;
    refreshRotated?: boolean;
  };
}
