import type { PipelineStage } from "mongoose";
import type { ContentFeatures, ContentFormat, InterestProfile } from "./interests.policy";

const CONTENT_FORMATS = ["text", "image", "mixed"] as const;
export const INTEREST_FORMAT_PRIOR = 1;
export type InterestFormatShares = Record<ContentFormat, number>;

type FormatGroup<T> = {
  assigned: number;
  queues: Record<ContentFormat, { entries: { value: T; position: number }[]; assigned: number }>;
};

export interface InterestRankBreakdown {
  freshness: number;
  popularity: number;
  topic: number;
  format: number;
}

export function interestFormatShares(profile: InterestProfile | undefined): InterestFormatShares | undefined {
  const total = CONTENT_FORMATS.reduce((sum, format) => sum + (profile?.formats[format] ?? 0), 0);
  if (total <= 0) return undefined;
  return Object.fromEntries(CONTENT_FORMATS.map(format => [
    format, ((profile?.formats[format] ?? 0) + INTEREST_FORMAT_PRIOR) / (total + INTEREST_FORMAT_PRIOR * CONTENT_FORMATS.length),
  ])) as InterestFormatShares;
}

function strongestInterest(features: ContentFeatures | undefined, affinities: ReadonlyMap<string, number>): string | undefined {
  return features?.topics.filter(topic => (affinities.get(topic.id) ?? 0) > 0)
    .sort((a, b) => b.weight * affinities.get(b.id)! - a.weight * affinities.get(a.id)!)[0]?.id;
}

export function mixInterestFormats<T extends { contentFeatures?: ContentFeatures }>(
  entries: readonly T[], shares: InterestFormatShares, affinities: ReadonlyMap<string, number>,
): T[] {
  const groups = new Map<string, FormatGroup<T>>();
  const slots = new Map<T, FormatGroup<T>>();
  entries.forEach((entry, position) => {
    if (!entry.contentFeatures || !CONTENT_FORMATS.includes(entry.contentFeatures.format)) return;
    const topic = strongestInterest(entry.contentFeatures, affinities) ?? "";
    let group = groups.get(topic);
    if (!group) {
      group = { assigned: 0, queues: {
        text: { entries: [], assigned: 0 }, image: { entries: [], assigned: 0 }, mixed: { entries: [], assigned: 0 },
      } };
      groups.set(topic, group);
    }
    group.queues[entry.contentFeatures.format].entries.push({ value: entry, position });
    slots.set(entry, group);
  });
  return entries.map(entry => {
    const group = slots.get(entry);
    if (!group) return entry;
    group.assigned++;
    const available = CONTENT_FORMATS.flatMap(format => {
      const queue = group.queues[format];
      const next = queue.entries[queue.assigned];
      return next ? [{ queue, position: next.position, deficit: group.assigned * shares[format] - queue.assigned }] : [];
    });
    available.sort((a, b) => b.deficit - a.deficit || a.position - b.position);
    const queue = available[0].queue;
    return queue.entries[queue.assigned++].value;
  });
}

export function topicAffinities(profile: InterestProfile | undefined): Map<string, number> {
  const topicTotal = Object.values(profile?.topics ?? {}).reduce((sum, value) => sum + value, 0);
  const affinities = new Map<string, number>();
  for (const id of profile?.selected ?? []) affinities.set(id, 0.4);
  for (const [id, score] of Object.entries(profile?.topics ?? {})) {
    affinities.set(id, Math.min(1, (affinities.get(id) ?? 0) + score / Math.max(1, topicTotal)));
  }
  return affinities;
}

export function interestRankingReason(features: ContentFeatures | undefined, profile: InterestProfile | undefined): string {
  const affinities = topicAffinities(profile);
  const matched = strongestInterest(features, affinities);
  if (matched) return `${(profile?.topics[matched] ?? 0) > 0 ? "learned" : "chosen"}:${matched}`;
  if (features && (profile?.formats[features.format] ?? 0) > 0) return `format:${features.format}`;
  return "activity";
}

export function buildInterestScoreStages(profile: InterestProfile | undefined, now: Date): PipelineStage[] {
  const formatTotal = Object.values(profile?.formats ?? {}).reduce((sum, value) => sum + value, 0);
  const affinities = topicAffinities(profile);
  const topicTerms = [...affinities].map(([id, affinity]) => ({
    $sum: { $map: {
      input: { $ifNull: ["$contentFeatures.topics", []] }, as: "topic",
      in: { $cond: [{ $eq: ["$$topic.id", id] }, { $multiply: ["$$topic.weight", affinity] }, 0] },
    } },
  }));
  const formatTerms = Object.entries(profile?.formats ?? {}).map(([format, score]) => ({
    $cond: [{ $eq: ["$contentFeatures.format", format] }, score / Math.max(1, formatTotal), 0],
  }));
  return [{ $addFields: { rankBreakdown: {
    freshness: { $multiply: [0.3, { $divide: [1, { $add: [1, { $divide: [{ $max: [0, { $subtract: [now, "$createdAt"] }] }, 86_400_000] }] }] }] },
    popularity: { $multiply: [0.2, { $min: [1, { $divide: [{ $ln: { $add: [1, { $max: [0, { $ifNull: ["$likesCount", 0] }] }, { $multiply: [2, { $max: [0, { $ifNull: ["$repostCount", 0] }] }] }] } }, Math.log(101)] }] }] },
    topic: { $multiply: [0.4, { $min: [1, { $add: [0, ...topicTerms] }] }] },
    format: { $multiply: [0.1, { $add: [0, ...formatTerms] }] },
  } } }, { $addFields: { rankScore: { $add: ["$rankBreakdown.freshness", "$rankBreakdown.popularity", "$rankBreakdown.topic", "$rankBreakdown.format"] } } }];
}
