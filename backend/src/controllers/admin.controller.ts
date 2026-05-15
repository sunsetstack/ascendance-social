import { Response } from "express";
import { injectable, inject } from "tsyringe";
import { Errors } from "@/utils/errors";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { DeletePostCommand } from "@/application/commands/post/deletePost/deletePost.command";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { GetAllPostsAdminQuery } from "@/application/queries/post/getAllPostsAdmin/getAllPostsAdmin.query";
import { GetDashboardStatsQuery } from "@/application/queries/admin/getDashboardStats/getDashboardStats.query";
import { DashboardStatsResult } from "@/application/queries/admin/getDashboardStats/getDashboardStats.handler";
import { PaginationResult, PostDTO, TypedRequest } from "@/types";
import { streamPaginatedResponse } from "@/utils/streamResponse";
import { GetAllUsersAdminQuery } from "@/application/queries/admin/getAllUsersAdmin/getAllUsersAdmin.query";
import { GetAdminUserProfileQuery } from "@/application/queries/admin/getAdminUserProfile/getAdminUserProfile.query";
import { GetUserStatsQuery } from "@/application/queries/admin/getUserStats/getUserStats.query";
import { GetRecentActivityQuery } from "@/application/queries/admin/getRecentActivity/getRecentActivity.query";
import { GetRequestLogsQuery } from "@/application/queries/admin/getRequestLogs/getRequestLogs.query";
import { BanUserCommand } from "@/application/commands/admin/banUser/banUser.command";
import { UnbanUserCommand } from "@/application/commands/admin/unbanUser/unbanUser.command";
import { PromoteToAdminCommand } from "@/application/commands/admin/promoteToAdmin/promoteToAdmin.command";
import { DemoteFromAdminCommand } from "@/application/commands/admin/demoteFromAdmin/demoteFromAdmin.command";
import { DeleteCommentCommand } from "@/application/commands/comments/deleteComment/deleteComment.command";
import { RemoveFavoriteAdminCommand } from "@/application/commands/favorite/removeFavoriteAdmin/removeFavoriteAdmin.command";
import { AdminUserDTO } from "@/services/dto.service";
import { escapeRegex } from "@/utils/sanitizers";
import { RedisService } from "@/services/redis.service";
import { CacheKeyBuilder } from "@/utils/cache/CacheKeyBuilder";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import type {
  AdminFavoriteParams,
  AdminImagesQuery,
  AdminUsersQuery,
  BanUserBody,
  CacheClearQuery,
  RecentActivityQuery,
  RequestLogsQuery,
} from "@/utils/schemas/admin.schemas";
import type { CommentIdParams } from "@/utils/schemas/comment.schemas";
import type { PublicIdParams as PostPublicIdParams } from "@/utils/schemas/post.schemas";
import type { PublicIdParams as UserPublicIdParams } from "@/utils/schemas/user.schemas";

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class AdminUserController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
    @inject(TOKENS.Services.Redis) private readonly redisService: RedisService,
  ) {}

  getAllUsersAdmin = async (
    req: TypedRequest<EmptyParams, EmptyBody, AdminUsersQuery>,
    res: Response,
  ) => {
    const { page, limit, sortBy, sortOrder, search, startDate, endDate } =
      req.query;

    const filter: {
      $or?: Array<Record<string, unknown>>;
      createdAt?: { $gte?: Date; $lte?: Date };
    } = {};

    if (search) {
      const searchRegex = {
        $regex: escapeRegex(String(search)),
        $options: "i",
      };
      filter.$or = [{ username: searchRegex }, { email: searchRegex }];
    }

    if (startDate || endDate) {
      filter.createdAt = {};
      if (typeof startDate === "string")
        filter.createdAt.$gte = new Date(startDate);
      if (typeof endDate === "string")
        filter.createdAt.$lte = new Date(endDate);
    }

    const options = {
      page,
      limit,
      sortBy,
      sortOrder,
      filter,
    };
    const query = new GetAllUsersAdminQuery(options);
    const result =
      await this.queryBus.execute<PaginationResult<AdminUserDTO>>(query);

    if (result.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, result.data, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } else {
      res.status(200).json(result);
    }
  };

  getUser = async (req: TypedRequest<UserPublicIdParams>, res: Response) => {
    const { publicId } = req.params;
    const query = new GetAdminUserProfileQuery(asUserPublicId(publicId));
    const adminDTO = await this.queryBus.execute<AdminUserDTO>(query);
    res.status(200).json(adminDTO);
  };

  getUserStats = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ) => {
    const { publicId } = req.params;
    const query = new GetUserStatsQuery(asUserPublicId(publicId));
    const stats = await this.queryBus.execute(query);
    res.status(200).json(stats);
  };

  deleteUser = async (req: TypedRequest<UserPublicIdParams>, res: Response) => {
    const { publicId } = req.params;
    // admin deletion bypasses password verification
    const command = new DeleteUserCommand(
      asUserPublicId(publicId),
      undefined,
      true,
    );
    await this.commandBus.dispatch(command);
    res.status(204).send();
  };

  banUser = async (
    req: TypedRequest<UserPublicIdParams, BanUserBody>,
    res: Response,
  ) => {
    const { decodedUser } = req;
    const { publicId } = req.params;
    const { reason } = req.body;
    if (!decodedUser) {
      throw Errors.validation("Admin user is required");
    }

    if (!decodedUser?.publicId) {
      throw Errors.validation("Admin publicId missing in token");
    }
    const command = new BanUserCommand(
      asUserPublicId(publicId),
      decodedUser.publicId,
      reason,
    );
    const result = await this.commandBus.dispatch<AdminUserDTO>(command);
    res.status(200).json(result);
  };

  unbanUser = async (req: TypedRequest<UserPublicIdParams>, res: Response) => {
    const { publicId } = req.params;
    const command = new UnbanUserCommand(asUserPublicId(publicId));
    const result = await this.commandBus.dispatch<AdminUserDTO>(command);
    res.status(200).json(result);
  };

  // === IMAGE MANAGEMENT ===
  getAllImages = async (
    req: TypedRequest<EmptyParams, EmptyBody, AdminImagesQuery>,
    res: Response,
  ) => {
    const { page, limit, sortBy, sortOrder } = req.query;
    const options = {
      page,
      limit,
      sortBy,
      sortOrder,
    };
    const posts = await this.queryBus.execute<PaginationResult<PostDTO>>(
      new GetAllPostsAdminQuery(
        options.page,
        options.limit,
        options.sortBy,
        options.sortOrder,
      ),
    );

    if (posts.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, posts.data, {
        total: posts.total,
        page: posts.page,
        limit: posts.limit,
        totalPages: posts.totalPages,
      });
    } else {
      res.status(200).json(posts);
    }
  };

  deleteImage = async (
    req: TypedRequest<PostPublicIdParams>,
    res: Response,
  ) => {
    const { publicId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("Admin user not found");
    }

    await this.commandBus.dispatch(
      new DeletePostCommand(asPostPublicId(publicId), decodedUser.publicId),
    );
    res.status(204).send();
  };

  deleteComment = async (req: TypedRequest<CommentIdParams>, res: Response) => {
    const { commentId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("Admin user not found");
    }

    await this.commandBus.dispatch(
      new DeleteCommentCommand(commentId, decodedUser.publicId),
    );
    res.status(204).send();
  };

  removeUserFavorite = async (
    req: TypedRequest<AdminFavoriteParams>,
    res: Response,
  ) => {
    const { publicId, postPublicId } = req.params;
    await this.commandBus.dispatch(
      new RemoveFavoriteAdminCommand(
        asUserPublicId(publicId),
        asPostPublicId(postPublicId),
      ),
    );
    res.status(204).send();
  };

  // === DASHBOARD STATS ===
  getDashboardStats = async (_req: TypedRequest, res: Response) => {
    const stats = await this.queryBus.execute<DashboardStatsResult>(
      new GetDashboardStatsQuery(),
    );
    res.status(200).json(stats);
  };

  // === RECENT ACTIVITY ===
  getRecentActivity = async (
    req: TypedRequest<EmptyParams, EmptyBody, RecentActivityQuery>,
    res: Response,
  ) => {
    const { page, limit } = req.query;
    const options = {
      page,
      limit,
    };
    const query = new GetRecentActivityQuery(options);
    const activity = await this.queryBus.execute(query);
    res.status(200).json(activity);
  };

  // === PROMOTE/DEMOTE ADMIN ===
  promoteToAdmin = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ) => {
    const { publicId } = req.params;
    const command = new PromoteToAdminCommand(asUserPublicId(publicId));
    const result = await this.commandBus.dispatch<AdminUserDTO>(command);
    res.status(200).json(result);
  };

  demoteFromAdmin = async (
    req: TypedRequest<UserPublicIdParams>,
    res: Response,
  ) => {
    const { publicId } = req.params;
    const command = new DemoteFromAdminCommand(asUserPublicId(publicId));
    const result = await this.commandBus.dispatch<AdminUserDTO>(command);
    res.status(200).json(result);
  };

  // === CACHE MANAGEMENT ===
  clearCache = async (
    req: TypedRequest<EmptyParams, EmptyBody, CacheClearQuery>,
    res: Response,
  ) => {
    const { pattern } = req.query;
    const patternToDelete = pattern ?? "all_feeds";

    let deletedCount = 0;

    if (patternToDelete === "all_feeds") {
      // clear all feed-related cache patterns
      const patterns = [
        ...CacheKeyBuilder.getGlobalFeedPatterns(true),
        "tag:*",
        "key_tags:*",
      ];

      for (const p of patterns) {
        deletedCount += await this.redisService.del(p);
      }
    } else {
      deletedCount = await this.redisService.del(patternToDelete);
    }

    res.status(200).json({
      message: "Cache cleared successfully",
      pattern: patternToDelete,
      deletedKeys: deletedCount,
    });
  };

  // === REQUEST LOGS ===
  getRequestLogs = async (
    req: TypedRequest<EmptyParams, EmptyBody, RequestLogsQuery>,
    res: Response,
  ) => {
    const { page, limit, userId, statusCode, startDate, endDate, search } =
      req.query;
    const options = {
      page,
      limit,
      userId,
      statusCode,
      startDate,
      endDate,
      search,
    };
    const query = new GetRequestLogsQuery(options);
    const result =
      await this.queryBus.execute<PaginationResult<unknown>>(query);

    if (Array.isArray(result.data) && result.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, result.data, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
      });
    } else {
      res.status(200).json(result);
    }
  };
}
