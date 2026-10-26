import { inject, injectable } from "tsyringe";
import mongoose, { Model } from "mongoose";
import { createHash } from "node:crypto";
import { TOKENS } from "@/types/tokens";
import { requireTransactionSession } from "@/database/UnitOfWork";
import { isFeedTraceEnabled, traceFeed } from "@/services/feed/feed-trace";
import type { StoredFeedProfile, StoredFeedSignal } from "@/models/feed-profile.model";
import { decayedSignalWeight, type ContentFeatures, type InterestProfile } from "@/services/feed/interests.policy";

function profileKey(userId: string): string {
  return createHash("sha256").update(`feed-profile-v1:${userId}`).digest("base64url");
}

@injectable()
export class FeedPreferenceRepository {
  constructor(
    @inject(TOKENS.Models.FeedProfile) private readonly profiles: Model<StoredFeedProfile>,
    @inject(TOKENS.Models.FeedSignal) private readonly signals: Model<StoredFeedSignal>,
  ) {}

  async read(userId: string, now = new Date()): Promise<InterestProfile> {
    const profile = await this.profiles.findOne({ userId }).lean().exec();
    const signals = await this.signals.find({ userId }).lean().exec();
    const topics: Record<string, number> = {};
    const formats: InterestProfile["formats"] = {};
    for (const signal of signals) {
      const weight = decayedSignalWeight(signal.kind, signal.at, now);
      if (isFeedTraceEnabled()) traceFeed("feed.profile.contribution", {
        profileKey: profileKey(userId),
        postId: String(signal.postId), kind: signal.kind, at: signal.at.toISOString(), evaluatedAt: now.toISOString(),
        decayedWeight: weight, classification: {
          version: signal.features.version,
          topics: signal.features.topics.map((topic) => ({ id: topic.id, weight: topic.weight })),
          format: signal.features.format,
        },
        topics: Object.fromEntries(signal.features.topics.map((topic) => [topic.id, topic.weight * weight])),
        format: { [signal.features.format]: weight },
      });
      for (const topic of signal.features.topics) {
        topics[topic.id] = (topics[topic.id] ?? 0) + topic.weight * weight;
      }
      formats[signal.features.format] = (formats[signal.features.format] ?? 0) + weight;
    }
    const result = { selected: profile?.selected ?? [], topics, formats, revision: profile?.revision ?? 0,
      onboardingCompleted: profile?.onboardingCompleted === true || (profile?.selected?.length ?? 0) > 0 };
    traceFeed("feed.profile.read", { profileKey: profileKey(userId), profile: result, signals: signals.length, evaluatedAt: now.toISOString() });
    return result;
  }

  async select(userId: string, selected: string[]): Promise<void> {
    await this.profiles.updateOne({ userId }, {
      $set: { selected, onboardingCompleted: true }, $inc: { revision: 1 },
    }, { upsert: true, session: requireTransactionSession() }).exec();
    traceFeed("feed.choices.staged", { profileKey: profileKey(userId), selected });
  }

  async reset(userId: string): Promise<void> {
    const session = requireTransactionSession();
    await this.profiles.updateOne({ userId }, {
      $set: { resetAt: new Date() }, $inc: { revision: 1 },
    }, { upsert: true, session }).exec();
    const removed = await this.signals.deleteMany({ userId }, { session }).exec();
    traceFeed("feed.learning.reset.staged", { profileKey: profileKey(userId), removedSignals: removed.deletedCount });
  }

  async setSignal(userId: string, postId: string, kind: "like" | "repost", features: ContentFeatures, active: boolean): Promise<void> {
    const session = requireTransactionSession();
    const filter = { userId: new mongoose.Types.ObjectId(userId), postId: new mongoose.Types.ObjectId(postId), kind };
    const previous = isFeedTraceEnabled() ? await this.signals.findOne(filter).session(session).lean().exec() : null;
    const now = new Date();
    let changed: boolean;
    if (active) {
      const result = await this.signals.updateOne(filter, {
        $setOnInsert: { ...filter, features, at: now },
      }, { upsert: true, session }).exec();
      changed = result.upsertedCount === 1;
    } else {
      const result = await this.signals.deleteOne(filter, { session }).exec();
      changed = result.deletedCount === 1;
    }
    await this.profiles.updateOne({ userId }, { $inc: { revision: 1 } }, { upsert: true, session }).exec();
    if (isFeedTraceEnabled()) {
      const recordedFeatures = active ? features : previous?.features;
      const delta = !changed ? 0 : active ? decayedSignalWeight(kind, now, now)
        : previous ? -decayedSignalWeight(kind, previous.at, now) : 0;
      traceFeed("feed.signal.staged", { postId, kind, active, changed, evaluatedAt: now.toISOString(),
        profileKey: profileKey(userId),
        classification: recordedFeatures ? {
          version: recordedFeatures.version,
          topics: recordedFeatures.topics.map((topic) => ({ id: topic.id, weight: topic.weight })),
          format: recordedFeatures.format,
        } : undefined, decayedDelta: delta,
        topicDelta: Object.fromEntries((recordedFeatures?.topics ?? []).map((topic) => [topic.id, topic.weight * delta])),
        formatDelta: recordedFeatures ? { [recordedFeatures.format]: delta } : {},
      });
    }
  }
}
