/**
 * Shared aggregation pipeline helpers for post queries.
 * Used by PostReadRepository and FeedReadDao to avoid duplication.
 */

import mongoose, { FilterQuery, PipelineStage } from "mongoose";
import { Errors } from "@/utils/errors";

export const ACTIVE_POST_FILTER: FilterQuery<any> = {
  $or: [{ status: "active" }, { status: { $exists: false } }],
};

export function withActivePostFilter<T extends Record<string, unknown>>(
  filter: T = {} as T,
): FilterQuery<any> {
  if (Object.keys(filter).length === 0) {
    return ACTIVE_POST_FILTER;
  }
  return { $and: [ACTIVE_POST_FILTER, filter] };
}

export function getStandardLookups(): PipelineStage.FacetPipelineStage[] {
  return [
    {
      $lookup: {
        from: "tags",
        localField: "tags",
        foreignField: "_id",
        as: "tagObjects",
      },
    },
    {
      $lookup: {
        from: "images",
        localField: "image",
        foreignField: "_id",
        as: "imageDoc",
      },
    },
    { $unwind: { path: "$imageDoc", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "communities",
        localField: "communityId",
        foreignField: "_id",
        as: "communityDoc",
      },
    },
    { $unwind: { path: "$communityDoc", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "posts",
        let: { repostId: "$repostOf" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$_id", "$$repostId"] },
              ...ACTIVE_POST_FILTER,
            },
          },
          {
            $lookup: {
              from: "images",
              localField: "image",
              foreignField: "_id",
              as: "repostImageDoc",
            },
          },
          {
            $unwind: {
              path: "$repostImageDoc",
              preserveNullAndEmptyArrays: true,
            },
          },
        ],
        as: "repostDoc",
      },
    },
    { $unwind: { path: "$repostDoc", preserveNullAndEmptyArrays: true } },
  ];
}

export function getStandardProjectionFields(): Record<string, unknown> {
  return {
    _id: 0,
    publicId: 1,
    body: 1,
    slug: 1,
    type: 1,
    repostCount: 1,
    createdAt: 1,
    likes: "$likesCount",
    viewsCount: { $ifNull: ["$viewsCount", 0] },
    commentsCount: 1,
    userPublicId: "$author.publicId",
    tags: {
      $map: {
        input: { $ifNull: ["$tagObjects", []] },
        as: "tag",
        in: { tag: "$$tag.tag", publicId: "$$tag.publicId" },
      },
    },
    user: {
      publicId: "$author.publicId",
      handle: "$author.handle",
      username: "$author.username",
      avatar: "$author.avatarUrl",
      displayName: "$author.displayName",
    },
    image: {
      $cond: {
        if: { $ne: ["$imageDoc", null] },
        then: {
          publicId: "$imageDoc.publicId",
          url: "$imageDoc.url",
          slug: "$imageDoc.slug",
        },
        else: {},
      },
    },
    repostOf: {
      $cond: {
        if: { $ne: ["$repostDoc", null] },
        then: {
          publicId: "$repostDoc.publicId",
          body: "$repostDoc.body",
          slug: "$repostDoc.slug",
          likesCount: "$repostDoc.likesCount",
          commentsCount: "$repostDoc.commentsCount",
          repostCount: "$repostDoc.repostCount",
          user: {
            publicId: "$repostDoc.author.publicId",
            handle: "$repostDoc.author.handle",
            username: "$repostDoc.author.username",
            avatar: "$repostDoc.author.avatarUrl",
          },
          image: {
            $cond: {
              if: { $ne: ["$repostDoc.repostImageDoc", null] },
              then: {
                publicId: "$repostDoc.repostImageDoc.publicId",
                url: "$repostDoc.repostImageDoc.url",
              },
              else: null,
            },
          },
        },
        else: null,
      },
    },
    community: {
      $cond: {
        if: { $ne: ["$communityDoc", null] },
        then: {
          publicId: "$communityDoc.publicId",
          name: "$communityDoc.name",
          slug: "$communityDoc.slug",
          avatar: "$communityDoc.avatar",
        },
        else: null,
      },
    },
  };
}

export function getStandardProjection(): PipelineStage.Project {
  return { $project: getStandardProjectionFields() };
}

export function buildFacetPipeline(
  ...stages: PipelineStage.FacetPipelineStage[]
): PipelineStage.FacetPipelineStage[] {
  return stages;
}

export function normalizeObjectId(
  id: unknown,
  field: string,
): mongoose.Types.ObjectId {
  if (id instanceof mongoose.Types.ObjectId) {
    return id;
  }
  if (typeof id !== "string" || id.length === 0) {
    throw Errors.validation(`${field} is not a valid ObjectId`);
  }
  try {
    return new mongoose.Types.ObjectId(id);
  } catch {
    throw Errors.validation(`${field} is not a valid ObjectId`);
  }
}

export function buildSort(
  sortBy: string,
  sortOrder: string,
): Record<string, 1 | -1> {
  return { [sortBy]: sortOrder === "asc" ? 1 : -1 };
}
