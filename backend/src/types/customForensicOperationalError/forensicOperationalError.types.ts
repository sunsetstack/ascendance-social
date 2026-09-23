export type ForensicErrorContext = {
  action?: string;
  resourceType?: string;
  postPublicId?: string;
  errorName?: string;
};

export type ForensicSerializedError = {
  name: string;
  message: string;
  stack?: string;
  code?: string | number;
  codeName?: string;
  errorLabels?: string[];
  statusCode?: number;
  errorCode?: string;
  context?: ForensicErrorContext;
  keyPattern?: Record<string, string | number | boolean>;
  cause?: ForensicSerializedError;
  errors?: ForensicSerializedError[];
  truncated?: boolean;
};

export type ForensicOperationalErrorActor = {
  type: "user" | "anonymous" | "system";
  userId?: string;
};

export type ForensicOperationalErrorRequest = {
  correlationId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  ip?: string;
  userAgent?: string;
};

export type ForensicOperationalErrorSession = {
  sessionId?: string;
  tokenFamilyId?: string;
  authSource?: string;
};

export interface ForensicOperationalErrorRecord {
  schemaVersion: 1;
  eventId: string;
  errorId: string;
  eventType: "operational.error";
  occurredAt: Date;
  recordedAt: Date;
  severity: "error" | "critical";
  operation: string;
  actor: ForensicOperationalErrorActor;
  request?: ForensicOperationalErrorRequest;
  session?: ForensicOperationalErrorSession;
  error: ForensicSerializedError;
}

export type NewForensicOperationalErrorRecord = Omit<
  ForensicOperationalErrorRecord,
  "recordedAt"
>;
