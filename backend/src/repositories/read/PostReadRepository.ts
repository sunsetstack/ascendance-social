import { Model, PipelineStage } from "mongoose";
import { inject, injectable } from "tsyringe";
import { FeedPost, IPost, PaginationOptions, PaginationResult } from "@/types";
import type { IPostReadRepository } from "../interfaces/IPostReadRepository";
import { BaseRepository } from "../base.repository";
import { TOKENS } from "@/types/tokens";
import {
  MongoId,
  PostPublicId,
  UserPublicId,
  asMongoId,
} from "@/types/branded";
import { Errors } from "@/utils/errors";
import {
  buildFacetPipeline,
  buildSort,
  ACTIVE_POST_FILTER,
  getStandardLookups,
  getStandardProjection,
  getStandardProjectionFields,
  normalizeObjectId,
  withActivePostFilter,
} from "@/repositories/post-pipeline.helpers";

type CountFacetResult = { count: number };
type PaginationFacetResult<T> = { data: T[]; totalCount: CountFacetResult[] };

@injectable()
export class PostReadRepository
  extends BaseRepository<IPost>
  implements IPostReadRepository
{
  constructor(@inject(TOKENS.Models.Post) model: Model<IPost>) {
    super(model);
  }

  async searchByText(terms: string[], limit: number = 20): Promise<FeedPost[]> {
    try {
      if (!terms.length) return [];

      const searchString = terms.join(" ");

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ $text: { $search: searchString } }) },
        { $addFields: { score: { $meta: "textScore" } } },
        { $sort: { score: { $meta: "textScore" } } },
        { $limit: limit },
        ...getStandardLookups(),
        getStandardProjection(),
      ];

      return await this.model.aggregate<FeedPost>(pipeline).exec();
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

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

  async findInternalIdsByPublicIds(
    publicIds: PostPublicId[],
  ): Promise<MongoId[]> {
    if (publicIds.length === 0) return [];
    const docs = await this.model
      .find(withActivePostFilter({ publicId: { $in: [...new Set(publicIds)] } }))
      .select("_id")
      .lean()
      .exec();
    return docs.map((doc) => asMongoId(String(doc._id)));
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

  async findByIdWithPopulates(id: MongoId): Promise<IPost | null> {
    try {
      const session = this.getSession();
      const query = this.model
        .findById(id)
        .populate("tags", "tag")
        .populate({ path: "image", select: "_id url publicId slug width height createdAt" });
      if (session) query.session(session);
      return await query.exec();
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
        .select(
          "publicId user author body slug type repostOf repostCount image tags likesCount commentsCount viewsCount createdAt updatedAt communityId",
        )
        .populate("tags", "tag")
        .populate({ path: "image", select: "_id url publicId slug width height createdAt" })
        .populate({ path: "communityId", select: "publicId name slug avatar" })
        .populate({
          path: "repostOf",
          select: "publicId body image user author tags",
          populate: [
            { path: "image", select: "_id url publicId slug width height createdAt" },
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
          select: "url publicId slug width height createdAt -_id",
        });
      if (session) query.session(session);
      return await query.exec();
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

  async findPostsByIds(
    ids: MongoId[],
    _viewerPublicId?: UserPublicId,
  ): Promise<FeedPost[]> {
    try {
      const objectIds = ids.map((id) => normalizeObjectId(id, "id"));
      if (objectIds.length === 0) return [];

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ _id: { $in: objectIds } }) },
        { $addFields: { inputOrder: { $indexOfArray: [objectIds, "$_id"] } } },
        { $sort: { inputOrder: 1 } },
        ...getStandardLookups(),
        {
          $project: {
            ...getStandardProjectionFields(),
          },
        },
      ];
      return await this.model.aggregate<FeedPost>(pipeline).exec();
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
      if (uniqueIds.length === 0) return [];
      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ publicId: { $in: uniqueIds } }) },
        ...getStandardLookups(),
        getStandardProjection(),
      ];
      return await this.model.aggregate<FeedPost>(pipeline).exec();
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
      const sort = buildSort(sortBy, sortOrder);

      const userDoc = await this.model.db
        .collection("users")
        .findOne({ publicId: userPublicId }, { projection: { _id: 1 } });
      if (!userDoc) throw Errors.notFound("User");

      const userId = normalizeObjectId(userDoc._id, "user._id");

      const pipeline: PipelineStage[] = [
        { $match: withActivePostFilter({ user: userId }) },
        { $sort: sort },
        {
          $facet: {
            data: buildFacetPipeline(
              { $skip: skip },
              { $limit: limit },
              ...getStandardLookups(),
              { $project: getStandardProjectionFields() },
            ),
            totalCount: buildFacetPipeline({ $count: "count" }),
          },
        },
      ];

      const [result] = await this.model
        .aggregate<PaginationFacetResult<FeedPost>>(pipeline)
        .exec();
      const data = result?.data ?? [];
      const total = result?.totalCount[0]?.count ?? 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
      const sort = buildSort(sortBy, sortOrder);

      const pipeline: PipelineStage[] = [
        { $match: ACTIVE_POST_FILTER },
        { $sort: sort },
        {
          $facet: {
            data: buildFacetPipeline(
              { $skip: skip },
              { $limit: limit },
              ...getStandardLookups(),
              getStandardProjection(),
            ),
            totalCount: buildFacetPipeline({ $count: "count" }),
          },
        },
      ];

      const aggregate =
        this.model.aggregate<PaginationFacetResult<FeedPost>>(pipeline);
      if (session) aggregate.session(session);

      const [result] = await aggregate.exec();
      const data = result?.data ?? [];
      const total = result?.totalCount[0]?.count ?? 0;
      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
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
      const page = options?.page ?? 1;
      const limit = options?.limit ?? 20;
      const sortOrder = options?.sortOrder ?? "desc";
      const sortBy = options?.sortBy ?? "createdAt";
      const skip = (page - 1) * limit;
      const sort = buildSort(sortBy, sortOrder);

      const [data, total] = await Promise.all([
        this.model
          .find(withActivePostFilter({ tags: { $in: tagIds } }))
          .populate("tags", "tag")
          .populate({ path: "image", select: "url publicId slug width height -_id" })
          .sort(sort)
          .skip(skip)
          .limit(limit)
          .exec(),
        this.model.countDocuments(
          withActivePostFilter({ tags: { $in: tagIds } }),
        ),
      ]);

      return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
    } catch (error: unknown) {
      throw Errors.database(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async countDocuments(filter: Record<string, unknown>): Promise<number> {
    return this.model.countDocuments(filter).exec();
  }

  async countByCommunityId(communityId: string): Promise<number> {
    return this.model.countDocuments({ communityId }).exec();
  }
}
