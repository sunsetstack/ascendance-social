import mongoose, { Document, Schema, Model } from "mongoose";

export interface IOutboxEvent extends Document {
  eventType: string;
  payload: any;
  traceId: string;
  correlationId?: string;
  clientRequestId?: string;
  causedByClientRequestId?: string;
  processed: boolean;
  error?: string;
  retries: number;
  processing: boolean;
  processingOwner?: string;
  processingStartedAt?: Date;
  nextAttemptAt?: Date;
  exhaustedAt?: Date;
  processedHandlers: string[];
  createdAt: Date;
  processedAt?: Date;
}

const outboxSchema = new Schema<IOutboxEvent>(
  {
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    traceId: {
      type: String,
      required: true,
      index: true,
    },
    correlationId: {
      type: String,
      index: true,
      sparse: true,
    },
    clientRequestId: { type: String },
    causedByClientRequestId: { type: String },
    processed: {
      type: Boolean,
      default: false,
      index: true, // Crucial for querying unprocessed events
    },
    error: {
      type: String,
    },
    retries: {
      type: Number,
      default: 0,
    },
    processing: {
      type: Boolean,
      default: false,
      index: true,
    },
    processingOwner: {
      type: String,
    },
    processingStartedAt: {
      type: Date,
    },
    nextAttemptAt: {
      type: Date,
    },
    exhaustedAt: {
      type: Date,
    },
    processedHandlers: {
      type: [String],
      default: [],
    },
    processedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

outboxSchema.index({
  processed: 1,
  exhaustedAt: 1,
  retries: 1,
  nextAttemptAt: 1,
  processing: 1,
  createdAt: 1,
});

export const OutboxModel: Model<IOutboxEvent> = mongoose.model<IOutboxEvent>(
  "Outbox",
  outboxSchema,
);
