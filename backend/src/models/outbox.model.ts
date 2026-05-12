import mongoose, { Document, Schema, Model } from "mongoose";

export interface IOutboxEvent extends Document {
  eventType: string;
  payload: any;
  processed: boolean;
  error?: string;
  retries: number;
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
    processedAt: {
      type: Date,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

outboxSchema.index({ processed: 1, createdAt: 1 }); // Compound index for background worker

export const OutboxModel: Model<IOutboxEvent> = mongoose.model<IOutboxEvent>("Outbox", outboxSchema);
