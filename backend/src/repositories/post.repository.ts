import mongoose, { Model, PipelineStage } from "mongoose";
import { inject, injectable } from "tsyringe";
import { BaseRepository } from "./base.repository";
import { IPost, PaginationOptions, PaginationResult, FeedPost } from "@/types";
import { Errors } from "@/utils/errors";
import { TagRepository } from "./tag.repository";
import { TOKENS } from "@/types/tokens";
import {
  MongoId,
  PostPublicId,
  UserPublicId,
  asMongoId,
} from "@/types/branded";
import {
  ACTIVE_POST_FILTER,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";

type CountFacetResult = {
  count: number;
};

type PaginationFacetResult<T> = {
  data: T[];
  totalCount: CountFacetResult[];
};

@injectable()
export class PostRepository extends BaseRepository<IPost> {
  constructor(
    @inject(TOKENS.Models.Post) model: Model<IPost>,
    @inject(TOKENS.Repositories.Tag)
    private readonly tagRepository: TagRepository,
  ) {
    super(model);
  }

  async searchByText(terms: string[], limit: number = 20): Promise<FeedPost[]> {
    try {
      if (!terms.length) return [];

      // MongoDB text search expects a space-separated string
      const searchString = terms.join(" ");

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ $text: { $search: searchString } }) },
        { $addFields: { score: { $meta: "textScore" } } },
        // Sort by text relevance score before trimming the result window
        { $sort: { score: { $meta: "textScore" } } },
        { $limit: limit },
        ...this.getStandardLookups(),
        this.getStandardProjection(),
      ];

      const results = await this.model.aggregate<FeedPost>(pipeline).exec();
      return results;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // in-process cache for tag name → ObjectId resolution; avoids repeated DB hits per feed request

  async findInternalIdByPublicId(
    publicId: PostPublicId,
  ): Promise<MongoId | null> {
    const doc = await this.model
      .findOne(withActivePostFilter({ publicId }))
      .select("_id")
      .lean()
      .exec();
    return doc ? asMongoId(String(doc._id)) : null;
  }

  async findOneByPublicId(publicId: PostPublicId): Promise<IPost | null> {
    try {
      const session = this.getSession();
      const query = this.model.findOne(withActivePostFilter({ publicId }));
      if (session) query.session(session);
      return await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findOneByFilter(
    filter: Record<string, unknown>,
  ): Promise<IPost | null> {
    try {
      return await this.model.findOne(filter).exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findByCommunityId(
    communityId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<IPost[]> {
    const skip = (page - 1) * limit;
    return this.model
      .find(withActivePostFilter({ communityId }))
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .populate("image")
      .exec();
  }

  async countByCommunityId(communityId: string): Promise<number> {
    return this.model.countDocuments(withActivePostFilter({ communityId })).exec();
  }

  async incrementViewCount(postId: mongoose.Types.ObjectId): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findOneAndUpdate(
        { _id: postId },
        { $inc: { viewsCount: 1 } },
        { new: true },
      );
      if (session) query.session(session);
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateRepostCount(postId: MongoId, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.updateOne(
        { _id: postId },
        { $inc: { repostCount: increment } },
      );
      if (session) query.session(session);
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private buildSort(sortBy: string, sortOrder: string): Record<string, 1 | -1> {
    return {
      [sortBy]: sortOrder === "asc" ? 1 : -1,
    };
  }

  async findByIdWithPopulates(id: MongoId): Promise<IPost | null> {
    try {
      const session = this.getSession();
      const query = this.model
        .findOne(withActivePostFilter({ _id: id }))
        .populate("tags", "tag")
        .populate({ path: "image", select: "_id url publicId slug createdAt" });

      if (session) query.session(session);
      return await query.exec();
    } catch (err: unknown) {
      throw Errors.database(err instanceof Error ? err.message : String(err));
    }
  }

  async findPostsByIds(
    ids: MongoId[],
    _viewerPublicId?: UserPublicId,
  ): Promise<FeedPost[]> {
    try {
      const objectIds = ids.map((id) => this.normalizeObjectId(id, "id"));

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ _id: { $in: objectIds } }) },
        ...this.getStandardLookups(),
        this.getStandardProjection(),
      ];

      // If viewerPublicId is provided, we could potentially add isLiked/isFavorited fields here
      // but that logic is usually handled in the service/DTO layer or via separate lookups.
      // For now, just return the posts.

      const results = await this.model.aggregate<FeedPost>(pipeline).exec();
      return results;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findPostsByPublicIds(publicIds: PostPublicId[]): Promise<FeedPost[]> {
    try {
      const uniqueIds = Array.from(
        new Set(
          publicIds.filter((id) => typeof id === "string" && id.length > 0),
        ),
      );
      if (uniqueIds.length === 0) {
        return [];
      }

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ publicId: { $in: uniqueIds } }) },
        ...this.getStandardLookups(),
        this.getStandardProjection(),
      ];

      const results = await this.model.aggregate<FeedPost>(pipeline).exec();
      return results;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findByPublicId(publicId: PostPublicId): Promise<IPost | null> {
    try {
      const session = this.getSession();
      const query = this.model
        .findOne(withActivePostFilter({ publicId }))
        .populate("tags", "tag")
        .populate({ path: "image", select: "_id url publicId slug createdAt" })
        .populate({ path: "communityId", select: "publicId name slug avatar" })
        .populate({
          path: "repostOf",
          select: "publicId body image user author tags",
          populate: [
            { path: "image", select: "_id url publicId slug createdAt" },
            { path: "tags", select: "tag" },
            {
              path: "user",
              select: "publicId handle username avatar profile displayName",
            },
          ],
        });

      if (session) query.session(session);
      return await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findBySlug(slug: string): Promise<IPost | null> {
    try {
      const session = this.getSession();
      const query = this.model
        .findOne(withActivePostFilter({ slug }))
        .populate("tags", "tag")
        .populate({
          path: "image",
          select: "url publicId slug createdAt -_id",
        });

      if (session) query.session(session);
      return await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findByUserPublicId(
    userPublicId: UserPublicId,
    options: PaginationOptions,
  ): Promise<PaginationResult<FeedPost>> {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;
      const skip = (page - 1) * limit;
      const sort = this.buildSort(sortBy, sortOrder);

      const userDoc = await this.model.db
        .collection("users")
        .findOne({ publicId: userPublicId }, { projection: { _id: 1 } });
      if (!userDoc) {
        throw Errors.notFound("User");
      }

      const userId = this.normalizeObjectId(userDoc._id, "user._id");

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ user: userId }) },
        { $sort: sort },
        {
          $facet: {
            data: this.buildFacetPipeline(
              { $skip: skip },
              { $limit: limit },
              ...this.getStandardLookups(),
              { $project: this.getStandardProjectionFields() },
            ),
            totalCount: this.buildFacetPipeline({ $count: "count" }),
          },
        },
      ];

      const [result] = await this.model
        .aggregate<PaginationFacetResult<FeedPost>>(pipeline)
        .exec();
      const data = result?.data ?? [];
      const total = result?.totalCount[0]?.count ?? 0;

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findWithPagination(
    options: PaginationOptions,
  ): Promise<PaginationResult<FeedPost>> {
    try {
      const session = this.getSession();
      const {
        page = 1,
        limit = 20,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = options;
      const skip = (page - 1) * limit;
      const sort = this.buildSort(sortBy, sortOrder);

      const pipeline: PipelineStage[] = [
        { $match: ACTIVE_POST_FILTER },
        { $sort: sort },
        {
          $facet: {
            data: this.buildFacetPipeline(
              { $skip: skip },
              { $limit: limit },
              ...this.getStandardLookups(),
              this.getStandardProjection(),
            ),
            totalCount: this.buildFacetPipeline({ $count: "count" }),
          },
        },
      ];

      const aggregate =
        this.model.aggregate<PaginationFacetResult<FeedPost>>(pipeline);
      if (session) aggregate.session(session);

      const [result] = await aggregate.exec();
      const results = result?.data ?? [];
      const total = result?.totalCount[0]?.count ?? 0;

      return {
        data: results,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async findByTags(
    tagIds: string[],
    options?: {
      page?: number;
      limit?: number;
      sortBy?: string;
      sortOrder?: string;
    },
  ): Promise<PaginationResult<IPost>> {
    try {
      const page = options?.page || 1;
      const limit = options?.limit || 20;
      const sortOrder = options?.sortOrder || "desc";
      const sortBy = options?.sortBy || "createdAt";
      const skip = (page - 1) * limit;
      const sort = this.buildSort(sortBy, sortOrder);

      const [data, total] = await Promise.all([
        this.model
          .find(withActivePostFilter({ tags: { $in: tagIds } }))
          .populate("tags", "tag")
          .populate({ path: "image", select: "url publicId slug -_id" })
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),
        this.model.countDocuments(withActivePostFilter({ tags: { $in: tagIds } })),
      ]);

      return {
        data,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateCommentCount(postId: MongoId, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        postId,
        { $inc: { commentsCount: increment } },
        { session },
      );
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async updateLikeCount(postId: MongoId, increment: number): Promise<void> {
    try {
      const session = this.getSession();
      const query = this.model.findByIdAndUpdate(
        postId,
        { $inc: { likesCount: increment } },
        { session },
      );
      await query.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async runAggregation<R = unknown>(pipeline: PipelineStage[]): Promise<R[]> {
    try {
      const session = this.getSession();
      const aggregation = this.model.aggregate(pipeline);
      if (session) aggregation.session(session);
      return await aggregation.exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async deleteManyByUserId(userId: MongoId): Promise<number> {
    try {
      const session = this.getSession();
      const query = this.model.deleteMany({ user: userId });
      if (session) query.session(session);
      const result = await query.exec();
      return result.deletedCount || 0;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Updates the embedded author snapshot for all posts belonging to a user
   * Used by the profile sync worker when a user changes avatar or username
   */
  async updateAuthorSnapshot(
    userObjectId: mongoose.Types.ObjectId,
    updates: {
      username?: string;
      avatarUrl?: string;
      displayName?: string;
      publicId?: string;
      handle?: string;
    },
  ): Promise<number> {
    try {
      const setFields: Record<string, string> = {};
      if (updates.username !== undefined) {
        setFields["author.username"] = updates.username;
      }
      if (updates.handle !== undefined) {
        setFields["author.handle"] = updates.handle;
      }
      if (updates.avatarUrl !== undefined) {
        setFields["author.avatarUrl"] = updates.avatarUrl;
      }
      if (updates.displayName !== undefined) {
        setFields["author.displayName"] = updates.displayName;
      }
      if (updates.publicId !== undefined) {
        setFields["author.publicId"] = updates.publicId;
      }

      if (Object.keys(setFields).length === 0) {
        return 0;
      }

      const result = await this.model
        .updateMany({ "author._id": userObjectId }, { $set: setFields })
        .exec();

      return result.modifiedCount || 0;
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private normalizeObjectId(
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

  private getStandardLookups(): PipelineStage.FacetPipelineStage[] {
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

      // lookup community for community posts
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

  private getStandardProjectionFields(): Record<string, unknown> {
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

      // Map the root userPublicId directly to the author snapshot
      userPublicId: "$author.publicId",

      tags: {
        $map: {
          input: { $ifNull: ["$tagObjects", []] },
          as: "tag",
          in: { tag: "$$tag.tag", publicId: "$$tag.publicId" },
        },
      },

      // Construct the User object from the Snapshot
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

      // community info for community posts
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

  private getStandardProjection(): PipelineStage.Project {
    return {
      $project: this.getStandardProjectionFields(),
    };
  }

  private buildFacetPipeline(
    ...stages: PipelineStage.FacetPipelineStage[]
  ): PipelineStage.FacetPipelineStage[] {
    return stages;
  }
}
