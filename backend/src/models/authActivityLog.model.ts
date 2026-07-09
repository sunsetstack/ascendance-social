import mongoose, { Schema } from "mongoose";
import { IAuthActivityLog } from "@/types";

const AuthActivityLogSchema = new Schema<IAuthActivityLog>(
  {
    timestamp: { type: Date, required: true },
    metadata: {
      action: { type: String, required: true },
      correlationId: { type: String },
      clientRequestId: { type: String },
      clientBootId: { type: String },
      clientRequestAttempt: { type: Number },
      axiosRetry: { type: Boolean },
      previousClientRequestId: { type: String },
      causedByClientRequestId: { type: String },
      sessionId: { type: String },
      tokenFamilyId: { type: String },
      userId: { type: String },
      authEmail: { type: String },
      authUsername: { type: String },
      authHandle: { type: String },
      ip: { type: String, required: true },
      origin: { type: String },
      referer: { type: String },
      userAgent: { type: String },
      route: { type: String },
      statusCode: { type: Number },
      responseTimeMs: { type: Number },
      authState: { type: String },
      authSource: { type: String },
      refreshRotated: { type: Boolean },
    },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "metadata",
      granularity: "seconds",
    },
    expireAfterSeconds: 60 * 60 * 24 * 90,
  },
);

AuthActivityLogSchema.index({ "metadata.userId": 1 });
AuthActivityLogSchema.index({ "metadata.action": 1 });
AuthActivityLogSchema.index({ "metadata.ip": 1 });
AuthActivityLogSchema.index({ "metadata.correlationId": 1 });
AuthActivityLogSchema.index({ "metadata.clientRequestId": 1 });
AuthActivityLogSchema.index({ "metadata.clientBootId": 1 });
AuthActivityLogSchema.index({ "metadata.sessionId": 1 });
AuthActivityLogSchema.index({ "metadata.tokenFamilyId": 1 });
AuthActivityLogSchema.index({ "metadata.causedByClientRequestId": 1 });
AuthActivityLogSchema.index({ "metadata.authState": 1 });
AuthActivityLogSchema.index({ "metadata.authSource": 1 });
AuthActivityLogSchema.index({ "metadata.authEmail": 1 });
AuthActivityLogSchema.index({ "metadata.authUsername": 1 });
AuthActivityLogSchema.index({ "metadata.authHandle": 1 });
AuthActivityLogSchema.index({ timestamp: -1, _id: -1 });
AuthActivityLogSchema.index({ "metadata.sessionId": 1, timestamp: -1 });
AuthActivityLogSchema.index({ "metadata.tokenFamilyId": 1, timestamp: -1 });
AuthActivityLogSchema.index({ "metadata.clientBootId": 1, timestamp: -1 });
AuthActivityLogSchema.index({ "metadata.clientRequestId": 1, timestamp: -1 });

export const AuthActivityLogModel = mongoose.model<IAuthActivityLog>(
  "AuthActivityLog",
  AuthActivityLogSchema,
  "authActivityLogs",
);
