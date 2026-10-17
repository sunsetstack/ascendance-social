import type { PipelineStage } from "mongoose";
import type { ContentFeatures, InterestProfile } from "./interests.policy";

export interface InterestRankBreakdown {
  freshness: number;
  popularity: number;
  topic: number;
  format: number;
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
  const matched = features?.topics.filter((topic) => (affinities.get(topic.id) ?? 0) > 0)
    .sort((a, b) => b.weight * affinities.get(b.id)! - a.weight * affinities.get(a.id)!)[0];
  if (matched) return `${(profile?.topics[matched.id] ?? 0) > 0 ? "learned" : "chosen"}:${matched.id}`;
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
