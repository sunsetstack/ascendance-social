import { Document } from "mongoose";

export type SecurityAuditOutcome = "success" | "failure" | "blocked";

export interface SecurityAuditActor {
  type: "user" | "admin" | "anonymous" | "system";
  userId?: string;
  email?: string;
  handle?: string;
  username?: string;
}

export interface SecurityAuditTarget {
  type?: string;
  id?: string;
}

export interface SecurityAuditRequestContext {
  correlationId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  ip?: string;
  userAgent?: string;
  origin?: string;
  referer?: string;
}

export interface SecurityAuditSessionContext {
  sessionId?: string;
  tokenFamilyId?: string;
  authSource?: string;
}

export interface ISecurityAuditEvent extends Document {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  actor: SecurityAuditActor;
  target?: SecurityAuditTarget;
  request?: SecurityAuditRequestContext;
  session?: SecurityAuditSessionContext;
  outcome: SecurityAuditOutcome;
  reason?: string;
  metadata?: Record<string, unknown>;
  previousHash: string;
  eventHash: string;
  archivedAt?: Date;
  archiveName?: string;
}
