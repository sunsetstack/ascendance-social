import mongoose, { Schema } from "mongoose";
import type { ContentFeatures } from "@/services/feed/interests.policy";

export interface StoredFeedProfile {
  userId: mongoose.Types.ObjectId;
  selected: string[];
  onboardingCompleted?: boolean;
  revision: number;
  resetAt: Date;
}

export interface StoredFeedSignal {
  userId: mongoose.Types.ObjectId;
  postId: mongoose.Types.ObjectId;
  kind: "like" | "repost";
  features: ContentFeatures;
  at: Date;
}

export const contentFeaturesSchema = new Schema<ContentFeatures>({
  version: { type: Number, required: true },
  topics: [{ _id: false, id: { type: String, required: true }, weight: { type: Number, required: true } }],
  format: { type: String, enum: ["text", "image", "mixed"], required: true },
}, { _id: false });

const profileSchema = new Schema<StoredFeedProfile>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  selected: { type: [String], default: [] },
  onboardingCompleted: { type: Boolean, default: false },
  revision: { type: Number, default: 0 },
  resetAt: { type: Date, default: () => new Date(0) },
});
const signalSchema = new Schema<StoredFeedSignal>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  postId: { type: Schema.Types.ObjectId, ref: "Post", required: true },
  kind: { type: String, enum: ["like", "repost"], required: true },
  features: { type: contentFeaturesSchema, required: true },
  at: { type: Date, required: true },
});
signalSchema.index({ userId: 1, postId: 1, kind: 1 }, { unique: true });
signalSchema.index({ postId: 1 });

export const FeedProfile = mongoose.model<StoredFeedProfile>("FeedProfile", profileSchema);
export const FeedSignal = mongoose.model<StoredFeedSignal>("FeedSignal", signalSchema);
