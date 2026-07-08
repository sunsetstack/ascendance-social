import mongoose, { Schema } from "mongoose";
import { IRequestLog } from "@/types";

const RequestLogSchema = new Schema<IRequestLog>(
  {
    timestamp: { type: Date, required: true },
    metadata: {
      userId: { type: String },
      correlationId: { type: String },
      method: { type: String, required: true },
      route: { type: String, required: true },
      ip: { type: String, required: true },
      userAgent: { type: String },
      statusCode: { type: Number, required: true },
      responseTimeMs: { type: Number, required: true },
      authAction: { type: String },
      authEmail: { type: String },
      authUsername: { type: String },
      authHandle: { type: String },
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
// Route might be high cardinality, but useful for exact match filtering if we add it later
RequestLogSchema.index({ "metadata.route": 1 });

export const RequestLogModel = mongoose.model<IRequestLog>(
  "RequestLog",
  RequestLogSchema,
);
