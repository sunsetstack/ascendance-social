import mongoose, { type PipelineStage } from "mongoose";
import {
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjectionFields,
  withActivePostFilter,
} from "./post-pipeline.helpers";
import {
  buildTrendingScoreStages,
  type TrendingScoreWeights,
} from "@/services/feed/trending-score.policy";
import { MAX_FEED_CURSOR_SNAPSHOT_ITEMS, type NewFeedCursorPayload } from "@/utils/feedCursor";
import { Errors } from "@/utils/errors";

const isBareRepost = {
  $and: [
    { $eq: [{ $ifNull: ["$body", ""] }, ""] },
    { $eq: [{ $ifNull: ["$image", null] }, null] },
  ],
};

const visibleIdentity = {
  $cond: [isBareRepost, { $ifNull: ["$repostOf", "$_id"] }, "$_id"],
};

export function getVisibleIdentityStages(): PipelineStage[] {
  return [
    {
      $group: {
        _id: visibleIdentity,
        post: { $first: "$$ROOT" },
      },
    },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ["$post", { visibleIdentityId: "$_id" }],
        },
      },
    },
  ];
}

export function buildCreatedAtCursorFilter(
  cursor: Pick<NewFeedCursorPayload, "createdAt" | "_id"> | null,
  direction: "forward" | "backward",
): Record<string, unknown> | null {
  if (!cursor) return null;
  const createdAt = "createdAt" in cursor ? cursor.createdAt : undefined;
  const id = "_id" in cursor ? cursor._id : undefined;
  if (createdAt === undefined && id === undefined) return null;
  if (!createdAt || !id) {
    throw Errors.validation("Invalid chronological feed cursor");
  }

  let cursorId: mongoose.Types.ObjectId;
  try {
    cursorId = new mongoose.Types.ObjectId(id);
  } catch {
    throw Errors.validation("Invalid chronological feed cursor");
  }
  const cursorDate = new Date(createdAt);
  const comparison = direction === "forward" ? "$lt" : "$gt";
  return {
    $or: [
      { createdAt: { [comparison]: cursorDate } },
      { createdAt: cursorDate, _id: { [comparison]: cursorId } },
    ],
  };
}

export function buildNewFeedPipeline(
  limit: number,
  direction: "forward" | "backward" = "forward",
  cursorFilter: Record<string, unknown> | null = null,
  seenIdentityIds: mongoose.Types.ObjectId[] = [],
): PipelineStage[] {
  const sortDirection = direction === "forward" ? -1 : 1;
  const newerThanCandidate = {
    $and: [
      { $gte: ["$createdAt", "$$candidateDate"] },
      {
        $or: [
          { $gt: ["$createdAt", "$$candidateDate"] },
          { $gt: ["$_id", "$$candidateId"] },
        ],
      },
    ],
  };

  return [
    { $match: withActivePostFilter(cursorFilter ?? {}) },
    { $sort: { createdAt: sortDirection, _id: sortDirection } },
    { $set: { visibleIdentityId: visibleIdentity } },
    ...(seenIdentityIds.length > 0
      ? [{ $match: { visibleIdentityId: { $nin: seenIdentityIds } } }]
      : []),
    // A candidate must be the newest member of its identity across all active posts.
    // The lookups deliberately ignore the page cursor, including on backward reads.
    {
      $lookup: {
        from: "posts",
        localField: "visibleIdentityId",
        foreignField: "repostOf",
        let: { candidateDate: "$createdAt", candidateId: "$_id" },
        pipeline: [
          {
            $match: {
              ...ACTIVE_POST_FILTER,
              $expr: { $and: [newerThanCandidate, isBareRepost] },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "newerWrapper",
      },
    },
    { $match: { "newerWrapper.0": { $exists: false } } },
    {
      $lookup: {
        from: "posts",
        localField: "visibleIdentityId",
        foreignField: "_id",
        let: { candidateDate: "$createdAt", candidateId: "$_id" },
        pipeline: [
          {
            $match: {
              ...ACTIVE_POST_FILTER,
              $expr: { $and: [newerThanCandidate, { $eq: [visibleIdentity, "$_id"] }] },
            },
          },
          { $project: { _id: 1 } },
        ],
        as: "newerIdentityPost",
      },
    },
    { $match: { "newerIdentityPost.0": { $exists: false } } },
    { $limit: limit + 1 },
    ...getStandardLookups(),
    {
      $project: {
        ...getStandardProjectionFields(),
        _id: 1,
        visibleIdentityId: 1,
        createdAt: 1,
        viewsCount: { $ifNull: ["$viewsCount", 0] },
      },
    },
  ];
}

export function buildTrendingSnapshotPipeline(
  asOf: Date,
  timeWindowDays: number,
  minLikes: number,
  weights: TrendingScoreWeights,
): PipelineStage[] {
  const sinceDate = new Date(asOf.getTime() - timeWindowDays * 24 * 60 * 60 * 1000);
  return [
    {
      $match: withActivePostFilter({
        createdAt: { $gte: sinceDate },
        likesCount: { $gte: minLikes },
      }),
    },
    ...buildTrendingScoreStages(asOf, weights),
    { $sort: { trendScore: -1, _id: -1 } },
    ...getVisibleIdentityStages(),
    { $sort: { trendScore: -1, _id: -1 } },
    { $limit: MAX_FEED_CURSOR_SNAPSHOT_ITEMS },
    {
      $project: {
        _id: 1,
        publicId: 1,
        visibleIdentityId: 1,
        trendScore: 1,
      },
    },
  ];
}

export function buildSnapshotHydrationPipeline(
  objectIds: mongoose.Types.ObjectId[],
  limit: number,
  eligibility: Record<string, unknown> = {},
  viewerMongoId?: string,
): PipelineStage[] {
  return [
    {
      $match: withActivePostFilter({
        ...eligibility,
        _id: { $in: objectIds },
      }),
    },
    { $addFields: { _snapshotPosition: { $indexOfArray: [objectIds, "$_id"] } } },
    { $sort: { _snapshotPosition: 1 } },
    { $limit: limit },
    ...getStandardLookups(),
    ...(viewerMongoId ? [{ $lookup: {
      from: "postlikes", let: { post: "$_id" },
      pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$postId", "$$post"] }, { $eq: ["$userId", new mongoose.Types.ObjectId(viewerMongoId)] }] } } }],
      as: "viewerLikes",
    } }, { $lookup: {
      from: "posts", let: { target: { $ifNull: ["$repostOf", "$_id"] } },
      pipeline: [{ $match: { user: new mongoose.Types.ObjectId(viewerMongoId), type: "repost", ...ACTIVE_POST_FILTER,
        $expr: { $eq: ["$repostOf", "$$target"] } } }], as: "viewerReposts",
    } }] : []),
    {
      $project: {
        ...getStandardProjectionFields(),
        ...(viewerMongoId ? { isLikedByViewer: { $gt: [{ $size: "$viewerLikes" }, 0] }, isRepostedByViewer: { $gt: [{ $size: "$viewerReposts" }, 0] } } : {}),
        _id: 1,
        createdAt: 1,
        viewsCount: { $ifNull: ["$viewsCount", 0] },
      },
    },
  ];
}
