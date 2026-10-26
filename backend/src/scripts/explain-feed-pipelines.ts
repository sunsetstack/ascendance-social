import "@/runtime/bootstrap-env";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import mongoose, { PipelineStage } from "mongoose";
import Post from "@/models/post.model";
import {
  buildCreatedAtCursorFilter,
  buildNewFeedPipeline,
  buildSnapshotHydrationPipeline,
  buildTrendingSnapshotPipeline,
} from "@/repositories/feed-pipeline.helpers";
import { resolveTrendingScoreWeights } from "@/services/feed/trending-score.policy";
import { MAX_FEED_CURSOR_SNAPSHOT_ITEMS } from "@/utils/feedCursor";

type ExplainMetric = {
  stage?: string;
  indexName?: string;
  nReturned?: number;
  totalKeysExamined?: number;
  totalDocsExamined?: number;
  executionTimeMillis?: number;
};

type ExplainReport = {
  name: string;
  warnings: string[];
  totals: {
    nReturned: number;
    totalKeysExamined: number;
    totalDocsExamined: number;
    executionTimeMillis: number;
  };
  indexes: string[];
  stages: string[];
};

type ExplainTotals = ExplainReport["totals"];

const limit = Math.min(
  100,
  Math.max(1, Number(process.env.FEED_EXPLAIN_LIMIT ?? 20)),
);

const connect = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is required to explain feed pipelines.");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 30_000,
    connectTimeoutMS: 30_000,
    socketTimeoutMS: 30_000,
  });
};

const collectMetrics = (value: unknown, metrics: ExplainMetric[]): void => {
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const metric: ExplainMetric = {};

  if (typeof record.stage === "string") metric.stage = record.stage;
  if (typeof record.indexName === "string") metric.indexName = record.indexName;
  if (typeof record.nReturned === "number") metric.nReturned = record.nReturned;
  if (typeof record.totalKeysExamined === "number") {
    metric.totalKeysExamined = record.totalKeysExamined;
  }
  if (typeof record.totalDocsExamined === "number") {
    metric.totalDocsExamined = record.totalDocsExamined;
  }
  if (typeof record.executionTimeMillis === "number") {
    metric.executionTimeMillis = record.executionTimeMillis;
  }

  if (Object.keys(metric).length > 0) {
    metrics.push(metric);
  }

  for (const nested of Object.values(record)) {
    if (Array.isArray(nested)) {
      nested.forEach((item) => collectMetrics(item, metrics));
    } else {
      collectMetrics(nested, metrics);
    }
  }
};

const summarizeExplain = (name: string, explain: unknown): ExplainReport => {
  const metrics: ExplainMetric[] = [];
  collectMetrics(explain, metrics);

  const stages = [
    ...new Set(metrics.map((metric) => metric.stage).filter(Boolean)),
  ] as string[];
  const indexes = [
    ...new Set(metrics.map((metric) => metric.indexName).filter(Boolean)),
  ] as string[];

  const initialTotals: ExplainTotals = {
    nReturned: 0,
    totalKeysExamined: 0,
    totalDocsExamined: 0,
    executionTimeMillis: 0,
  };

  const totals = metrics.reduce<ExplainTotals>(
    (acc, metric) => ({
      nReturned: Math.max(acc.nReturned, metric.nReturned ?? 0),
      totalKeysExamined:
        acc.totalKeysExamined + (metric.totalKeysExamined ?? 0),
      totalDocsExamined:
        acc.totalDocsExamined + (metric.totalDocsExamined ?? 0),
      executionTimeMillis: Math.max(
        acc.executionTimeMillis,
        metric.executionTimeMillis ?? 0,
      ),
    }),
    initialTotals,
  );

  const warnings: string[] = [];
  if (stages.includes("COLLSCAN")) {
    warnings.push("COLLSCAN detected. Check match/sort indexes.");
  }
  if (totals.totalDocsExamined > Math.max(limit * 50, 1000)) {
    warnings.push("High docs examined relative to page limit.");
  }
  if (totals.totalKeysExamined > Math.max(limit * 100, 2000)) {
    warnings.push("High keys examined relative to page limit.");
  }

  return { name, warnings, totals, indexes, stages };
};

const explainAggregation = async (
  name: string,
  pipeline: PipelineStage[],
): Promise<ExplainReport> => {
  const explain = await Post.aggregate(pipeline).explain("executionStats");

  const outputDirectory = path.resolve("tmp/feed-explain");
  await mkdir(outputDirectory, { recursive: true });

  await writeFile(
    path.join(outputDirectory, `${name}.json`),
    JSON.stringify(explain, null, 2),
    "utf8",
  );

  return summarizeExplain(name, explain);
};

const main = async (): Promise<void> => {
  await connect();
  const reports: ExplainReport[] = [];
  const newPipeline = buildNewFeedPipeline(limit);
  reports.push(await explainAggregation("new_feed_cursor", newPipeline));
  const firstPage = await Post.aggregate<{ _id: mongoose.Types.ObjectId; createdAt: Date }>(newPipeline).exec();
  if (firstPage.length > limit) {
    const anchor = firstPage[limit - 1];
    const cursorFilter = buildCreatedAtCursorFilter({
      createdAt: new Date(anchor.createdAt).toISOString(),
      _id: String(anchor._id),
    }, "forward");
    reports.push(await explainAggregation("new_feed_continuation",
      buildNewFeedPipeline(limit, "forward", cursorFilter)));
  }

  const trendingPipeline = buildTrendingSnapshotPipeline(new Date(), 30, 1, resolveTrendingScoreWeights());
  reports.push(await explainAggregation("trending_feed_snapshot", trendingPipeline));
  const entries = await Post.aggregate<{ _id: mongoose.Types.ObjectId }>(trendingPipeline).exec();
  if (entries.length > MAX_FEED_CURSOR_SNAPSHOT_ITEMS) {
    throw new Error("Feed cursor snapshot contains too many items");
  }
  if (entries.length > 0) {
    const ids = entries.slice(0, Math.max(limit * 2, 50)).map((entry) => entry._id);
    reports.push(await explainAggregation("trending_feed_hydration_first_batch",
      buildSnapshotHydrationPipeline(ids, limit + 1)));
  }
  console.log(JSON.stringify({ limit, reports }, null, 2));
};
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
