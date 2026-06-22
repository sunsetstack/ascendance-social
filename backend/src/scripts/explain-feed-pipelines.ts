import "@/runtime/bootstrap-env";
import mongoose, { PipelineStage } from "mongoose";
import Post from "@/models/post.model";
import User from "@/models/user.model";
import Follow from "@/models/follow.model";
import { Tag } from "@/models/image.model";
import { UserPreference } from "@/models/userPreference.model";
import {
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjectionFields,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";

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
const sampleUserPublicId = process.env.FEED_EXPLAIN_USER_PUBLIC_ID;

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

const buildFeedProjection = (): Record<string, unknown> => ({
  ...getStandardProjectionFields(),
  _id: 1,
});

const buildNewFeedPipeline = (): PipelineStage[] => [
  { $match: ACTIVE_POST_FILTER },
  { $sort: { createdAt: -1, _id: -1 } },
  { $limit: limit + 1 },
  ...getStandardLookups(),
  { $project: buildFeedProjection() },
];

const buildTrendingFeedPipeline = (): PipelineStage[] => {
  const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  return [
    {
      $match: withActivePostFilter({
        createdAt: { $gte: sinceDate },
        likesCount: { $gte: 1 },
      }),
    },
    {
      $addFields: {
        recencyScore: {
          $divide: [
            1,
            {
              $add: [
                1,
                {
                  $divide: [
                    { $subtract: [new Date(), "$createdAt"] },
                    1000 * 60 * 60 * 24,
                  ],
                },
              ],
            },
          ],
        },
        popularityScore: {
          $ln: {
            $add: [{ $max: [0, { $ifNull: ["$likesCount", 0] }] }, 1],
          },
        },
        commentsScore: {
          $ln: {
            $add: [{ $max: [0, { $ifNull: ["$commentsCount", 0] }] }, 1],
          },
        },
      },
    },
    {
      $addFields: {
        trendScore: {
          $add: [
            { $multiply: [0.4, "$recencyScore"] },
            { $multiply: [0.5, "$popularityScore"] },
            { $multiply: [0.1, "$commentsScore"] },
          ],
        },
      },
    },
    { $sort: { trendScore: -1, _id: -1 } },
    { $limit: limit + 1 },
    ...getStandardLookups(),
    { $project: { ...buildFeedProjection(), trendScore: 1 } },
  ];
};

const buildRankedFeedPipeline = (
  favoriteTagIds: mongoose.Types.ObjectId[],
): PipelineStage[] => {
  const sinceDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  return [
    { $match: withActivePostFilter({ createdAt: { $gte: sinceDate } }) },
    {
      $addFields: {
        recencyScore: {
          $divide: [
            1,
            {
              $add: [
                1,
                {
                  $divide: [
                    { $subtract: [new Date(), "$createdAt"] },
                    1000 * 60 * 60 * 24,
                  ],
                },
              ],
            },
          ],
        },
        popularityScore: {
          $ln: {
            $add: [{ $max: [0, { $ifNull: ["$likesCount", 0] }] }, 1],
          },
        },
        tagMatchScore:
          favoriteTagIds.length > 0
            ? { $size: { $setIntersection: ["$tags", favoriteTagIds] } }
            : 0,
      },
    },
    {
      $addFields: {
        rankScore: {
          $add: [
            { $multiply: ["$recencyScore", 0.5] },
            { $multiply: ["$popularityScore", 0.3] },
            { $multiply: ["$tagMatchScore", 0.2] },
          ],
        },
      },
    },
    { $sort: { rankScore: -1, _id: -1 } },
    { $limit: limit + 1 },
    ...getStandardLookups(),
    { $project: { ...buildFeedProjection(), rankScore: 1 } },
  ];
};

const buildPersonalizedPipeline = (
  followingIds: mongoose.Types.ObjectId[],
  favoriteTagIds: mongoose.Types.ObjectId[],
): PipelineStage[] | null => {
  const orConditions: Record<string, unknown>[] = [];
  if (followingIds.length > 0) {
    orConditions.push({ user: { $in: followingIds } });
  }
  if (favoriteTagIds.length > 0) {
    orConditions.push({ tags: { $in: favoriteTagIds } });
  }
  if (orConditions.length === 0) {
    return null;
  }

  return [
    { $match: withActivePostFilter({ $or: orConditions }) },
    { $sort: { createdAt: -1, _id: -1 } },
    { $limit: limit + 1 },
    ...getStandardLookups(),
    { $addFields: { isPersonalized: true } },
    { $project: buildFeedProjection() },
  ];
};

const getSampleUser = async () => {
  if (sampleUserPublicId) {
    return User.findOne({ publicId: sampleUserPublicId }).select(
      "_id publicId",
    );
  }

  return User.findOne({}).sort({ createdAt: -1 }).select("_id publicId");
};

const getFavoriteTagIds = async (
  userId?: mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId[]> => {
  if (!userId) return [];

  const preferences = await UserPreference.find({ userId })
    .sort({ score: -1 })
    .limit(20)
    .select("tag")
    .lean();

  if (preferences.length === 0) return [];

  const tagNames = preferences.map((preference) => preference.tag);
  const tags = await Tag.find({ tag: { $in: tagNames } }).select("_id").lean();
  return tags.map((tag) => tag._id as mongoose.Types.ObjectId);
};

const getFollowingIds = async (
  userId?: mongoose.Types.ObjectId,
): Promise<mongoose.Types.ObjectId[]> => {
  if (!userId) return [];

  const follows = await Follow.find({ followerId: userId })
    .limit(1000)
    .select("followeeId")
    .lean();

  return follows.map((follow) => follow.followeeId as mongoose.Types.ObjectId);
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
      totalKeysExamined: acc.totalKeysExamined + (metric.totalKeysExamined ?? 0),
      totalDocsExamined: acc.totalDocsExamined + (metric.totalDocsExamined ?? 0),
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
  return summarizeExplain(name, explain);
};

const main = async (): Promise<void> => {
  await connect();

  const sampleUser = await getSampleUser();
  const userObjectId = sampleUser?._id as mongoose.Types.ObjectId | undefined;
  const [favoriteTagIds, followingIds] = await Promise.all([
    getFavoriteTagIds(userObjectId),
    getFollowingIds(userObjectId),
  ]);

  const reports: ExplainReport[] = [];
  reports.push(await explainAggregation("new_feed_cursor", buildNewFeedPipeline()));
  reports.push(
    await explainAggregation("trending_feed_cursor", buildTrendingFeedPipeline()),
  );
  reports.push(
    await explainAggregation(
      "ranked_feed_fallback",
      buildRankedFeedPipeline(favoriteTagIds),
    ),
  );

  const personalizedPipeline = buildPersonalizedPipeline(
    followingIds,
    favoriteTagIds,
  );
  if (personalizedPipeline) {
    reports.push(
      await explainAggregation("personalized_feed_core", personalizedPipeline),
    );
  }

  console.log(
    JSON.stringify(
      {
        limit,
        sampleUserPublicId: sampleUser?.publicId ?? null,
        followingCountSampled: followingIds.length,
        favoriteTagCountSampled: favoriteTagIds.length,
        reports,
      },
      null,
      2,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
