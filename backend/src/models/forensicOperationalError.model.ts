import mongoose, { Schema } from "mongoose";
import type { ForensicOperationalErrorRecord } from "@/types";

const ForensicOperationalErrorSchema =
  new Schema<ForensicOperationalErrorRecord>(
    {
      schemaVersion: {
        type: Number,
        required: true,
        enum: [1],
        immutable: true,
      },
      eventId: {
        type: String,
        required: true,
        unique: true,
        immutable: true,
      },
      errorId: {
        type: String,
        required: true,
        unique: true,
        immutable: true,
      },
      eventType: {
        type: String,
        required: true,
        enum: ["operational.error"],
        immutable: true,
      },
      occurredAt: { type: Date, required: true, immutable: true },
      recordedAt: { type: Date, required: true, immutable: true },
      severity: {
        type: String,
        required: true,
        enum: ["error", "critical"],
        immutable: true,
      },
      operation: { type: String, required: true, immutable: true },
      actor: {
        type: {
          type: String,
          required: true,
          enum: ["user", "anonymous", "system"],
          immutable: true,
        },
        userId: { type: String, immutable: true },
      },
      request: {
        correlationId: { type: String, immutable: true },
        clientRequestId: { type: String, immutable: true },
        clientBootId: { type: String, immutable: true },
        clientRequestAttempt: { type: Number, immutable: true },
        previousClientRequestId: { type: String, immutable: true },
        causedByClientRequestId: { type: String, immutable: true },
        method: { type: String, immutable: true },
        route: { type: String, immutable: true },
        statusCode: { type: Number, immutable: true },
        ip: { type: String, immutable: true },
        userAgent: { type: String, immutable: true },
      },
      session: {
        sessionId: { type: String, immutable: true },
        tokenFamilyId: { type: String, immutable: true },
        authSource: { type: String, immutable: true },
      },
      error: {
        type: Schema.Types.Mixed,
        required: true,
        immutable: true,
      },
    },
    {
      collection: "forensicOperationalErrors",
      minimize: true,
      strict: "throw",
      versionKey: false,
    },
  );

ForensicOperationalErrorSchema.index({ recordedAt: 1, eventId: 1 });
ForensicOperationalErrorSchema.index({ "request.correlationId": 1 });
ForensicOperationalErrorSchema.index({ "actor.userId": 1, recordedAt: -1 });
ForensicOperationalErrorSchema.index({
  "session.sessionId": 1,
  recordedAt: -1,
});
ForensicOperationalErrorSchema.index({
  "session.tokenFamilyId": 1,
  recordedAt: -1,
});

export const ForensicOperationalErrorModel =
  mongoose.model<ForensicOperationalErrorRecord>(
    "ForensicOperationalError",
    ForensicOperationalErrorSchema,
  );
