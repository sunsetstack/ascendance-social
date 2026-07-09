import mongoose, { Schema } from "mongoose";
import { IRequestLog } from "@/types";

const RequestLogSchema = new Schema<IRequestLog>(
  {
    timestamp: { type: Date, required: true },
    metadata: {
      userId: { type: String },
      correlationId: { type: String },
      clientRequestId: { type: String },
      clientBootId: { type: String },
      clientRequestAttempt: { type: Number },
      axiosRetry: { type: Boolean },
      previousClientRequestId: { type: String },
      causedByClientRequestId: { type: String },
      sessionId: { type: String },
      tokenFamilyId: { type: String },
      method: { type: String, required: true },
      route: { type: String, required: true },
      ip: { type: String, required: true },
      origin: { type: String },
      referer: { type: String },
      userAgent: { type: String },
      statusCode: { type: Number, required: true },
      responseTimeMs: { type: Number, required: true },
      authState: { type: String },
      authSource: { type: String },
      authAction: { type: String },
      authEmail: { type: String },
      authUsername: { type: String },
      authHandle: { type: String },
      refreshRotated: { type: Boolean },
    },
  },
  {
    timeseries: {
      timeField: "timestamp",
      metaField: "metadata",
      granularity: "seconds",
    },
    expireAfterSeconds: 60 * 60 * 24 * 90, // 90 days
  },
);

// Indexes for search and filtering
RequestLogSchema.index({ "metadata.userId": 1 });
RequestLogSchema.index({ "metadata.ip": 1 });
RequestLogSchema.index({ "metadata.method": 1 });
RequestLogSchema.index({ "metadata.statusCode": 1 });
RequestLogSchema.index({ "metadata.correlationId": 1 });
RequestLogSchema.index({ "metadata.sessionId": 1 });
RequestLogSchema.index({ "metadata.tokenFamilyId": 1 });
RequestLogSchema.index({ "metadata.clientRequestId": 1 });
RequestLogSchema.index({ "metadata.clientBootId": 1 });
RequestLogSchema.index({ "metadata.causedByClientRequestId": 1 });
RequestLogSchema.index({ "metadata.authState": 1 });
RequestLogSchema.index({ "metadata.authSource": 1 });
// Route might be high cardinality, but useful for exact match filtering if we add it later
RequestLogSchema.index({ "metadata.route": 1 });
RequestLogSchema.index({ timestamp: -1, _id: -1 });
RequestLogSchema.index({ "metadata.sessionId": 1, timestamp: -1 });
RequestLogSchema.index({ "metadata.tokenFamilyId": 1, timestamp: -1 });
RequestLogSchema.index({ "metadata.clientBootId": 1, timestamp: -1 });
RequestLogSchema.index({ "metadata.clientRequestId": 1, timestamp: -1 });
RequestLogSchema.index({ "metadata.causedByClientRequestId": 1, timestamp: -1 });

export const RequestLogModel = mongoose.model<IRequestLog>(
  "RequestLog",
  RequestLogSchema,
);
