import mongoose, { Schema } from "mongoose";
import { ISecurityAuditEvent } from "@/types";

function resolveAuditTtlSeconds(): number | undefined {
  const raw = process.env.SECURITY_AUDIT_MONGO_TTL_DAYS;
  const days = raw === undefined ? 90 : Number(raw);
  if (!Number.isFinite(days) || days <= 0) {
    return undefined;
  }

  return Math.floor(days * 24 * 60 * 60);
}

const SecurityAuditEventSchema = new Schema<ISecurityAuditEvent>(
  {
    eventId: { type: String, required: true, unique: true },
    eventType: { type: String, required: true },
    occurredAt: { type: Date, required: true },
    actor: {
      type: { type: String, required: true },
      userId: { type: String },
      email: { type: String },
      handle: { type: String },
      username: { type: String },
    },
    target: {
      type: { type: String },
      id: { type: String },
    },
    request: {
      correlationId: { type: String },
      clientRequestId: { type: String },
      clientBootId: { type: String },
      clientRequestAttempt: { type: Number },
      axiosRetry: { type: Boolean },
      previousClientRequestId: { type: String },
      causedByClientRequestId: { type: String },
      method: { type: String },
      route: { type: String },
      statusCode: { type: Number },
      ip: { type: String },
      userAgent: { type: String },
      origin: { type: String },
      referer: { type: String },
    },
    session: {
      sessionId: { type: String },
      tokenFamilyId: { type: String },
      authSource: { type: String },
    },
    outcome: {
      type: String,
      required: true,
      enum: ["success", "failure", "blocked"],
    },
    reason: { type: String },
    metadata: { type: Schema.Types.Mixed },
    previousHash: { type: String, required: true },
    eventHash: { type: String, required: true },
    archivedAt: { type: Date },
    archiveName: { type: String },
  },
  { minimize: true },
);

SecurityAuditEventSchema.index({ occurredAt: -1, _id: -1 });
SecurityAuditEventSchema.index({ eventType: 1, occurredAt: -1 });
SecurityAuditEventSchema.index({ "actor.userId": 1, occurredAt: -1 });
SecurityAuditEventSchema.index({ "target.id": 1, occurredAt: -1 });
SecurityAuditEventSchema.index({ "request.correlationId": 1 });
SecurityAuditEventSchema.index({ "request.clientRequestId": 1 });
SecurityAuditEventSchema.index({ "session.sessionId": 1, occurredAt: -1 });
SecurityAuditEventSchema.index({ "session.tokenFamilyId": 1, occurredAt: -1 });
SecurityAuditEventSchema.index({ eventHash: 1 });

const ttlSeconds = resolveAuditTtlSeconds();
if (ttlSeconds) {
  SecurityAuditEventSchema.index(
    { occurredAt: 1 },
    { expireAfterSeconds: ttlSeconds },
  );
}

export const SecurityAuditEventModel = mongoose.model<ISecurityAuditEvent>(
  "SecurityAuditEvent",
  SecurityAuditEventSchema,
  "securityAuditEvents",
);
