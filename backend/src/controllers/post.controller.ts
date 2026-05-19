import { Response } from "express";
import { inject, injectable } from "tsyringe";
import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { CreatePostCommand } from "@/application/commands/post/createPost/createPost.command";
import { DeletePostCommand } from "@/application/commands/post/deletePost/deletePost.command";
import { RecordPostViewCommand } from "@/application/commands/post/recordPostView/recordPostView.command";
import { RepostPostCommand } from "@/application/commands/post/repostPost/repostPost.command";
import { UnrepostPostCommand } from "@/application/commands/post/unrepostPost/unrepostPost.command";
import { GetPostByPublicIdQuery } from "@/application/queries/post/getPostByPublicId/getPostByPublicId.query";
import { GetPostBySlugQuery } from "@/application/queries/post/getPostBySlug/getPostBySlug.query";
import { GetPostsQuery } from "@/application/queries/post/getPosts/getPosts.query";
import { GetPostsByUserQuery } from "@/application/queries/post/getPostsByUser/getPostsByUser.query";
import { GetLikedPostsByUserQuery } from "@/application/queries/post/getLikedPostsByUser/getLikedPostsByUser.query";
import { SearchPostsByTagsQuery } from "@/application/queries/post/searchPostsByTags/searchPostsByTags.query";
import { GetAllTagsQuery } from "@/application/queries/tags/getAllTags/getAllTags.query";
import { GetUserByHandleQuery } from "@/application/queries/users/getUserByHandle/getUserByHandle.query";
import { Errors } from "@/utils/errors";
import {
  ITag,
  PaginationResult,
  PostDTO,
  TypedRequest,
  UserPostsResult,
} from "@/types";
import { streamPaginatedResponse } from "@/utils/streamResponse";
import { safeFireAndForget } from "@/utils/helpers";
import { PublicUserDTO } from "@/services/dto.service";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";
import { asPostPublicId, asUserPublicId } from "@/types/branded";
import type {
  CreatePostBody,
  HandlePostsQuery,
  ListPostsQuery,
  PublicIdParams as PostPublicIdParams,
  RepostBody,
  SearchByTagsQuery as SearchByTagsQueryParams,
  SlugParams,
  UserPostsQuery,
} from "@/utils/schemas/post.schemas";
import type { HandleParams as UserHandleParams } from "@/utils/schemas/user.schemas";

/** Regex to strip file extensions (e.g., .png, .jpg) from slugs/IDs */
const FILE_EXTENSION_REGEX = /\.[a-z0-9]{2,5}$/i;

/** Threshold for enabling streaming responses (items) */
import { STREAM_THRESHOLD } from "@/utils/post-helpers";

type EmptyParams = Record<string, never>;
type EmptyBody = Record<string, never>;

@injectable()
export class PostController {
  constructor(
    @inject(TOKENS.CQRS.Commands.Bus) private readonly commandBus: CommandBus,
    @inject(TOKENS.CQRS.Queries.Bus) private readonly queryBus: QueryBus,
  ) {}

  createPost = async (
    req: TypedRequest<EmptyParams, CreatePostBody>,
    res: Response,
  ): Promise<void> => {
    const { decodedUser, file } = req;
    // Zod validation middleware has already processed and validated req.body
    const { body: bodyText, communityPublicId } = req.body;

    if (!file && (!bodyText || bodyText.trim().length === 0)) {
      throw Errors.validation("Provide either an image or body text", {
        context: { operation: "createPost" },
      });
    }

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User information missing");
    }

    const originalName = file?.originalname || `post-${Date.now()}`;

    // Use buffer from memory storage
    const command = new CreatePostCommand(
      decodedUser.publicId,
      bodyText,
      undefined,
      undefined,
      originalName,
      communityPublicId,
      file?.buffer,
      file?.mimetype,
    );
    const postDTO = await this.commandBus.dispatch<PostDTO>(command);
    res.status(201).json(postDTO);
  };

  listPosts = async (
    req: TypedRequest<EmptyParams, EmptyBody, ListPostsQuery>,
    res: Response,
  ): Promise<void> => {
    const { page, limit } = req.query;

    // Get authenticated user's publicId if available
    const userId = req.decodedUser?.publicId;
    logger.info(
      "listPosts called with page:",
      page,
      "limit:",
      limit,
      "userId:",
      userId,
    );

    const posts = await this.queryBus.execute<PaginationResult<PostDTO>>(
      new GetPostsQuery(page, limit, userId),
    );

    if (posts.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, posts.data, {
        total: posts.total,
        page: posts.page,
        limit: posts.limit,
        totalPages: posts.totalPages,
      });
    } else {
      res.json(posts);
    }
  };

  getPostsByUserPublicId = async (
    req: TypedRequest<PostPublicIdParams, EmptyBody, UserPostsQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit, sortBy, sortOrder } = req.query;

    const query = new GetPostsByUserQuery(
      asUserPublicId(publicId),
      page,
      limit,
      sortBy,
      sortOrder,
    );
    const posts = await this.queryBus.execute<UserPostsResult>(query);

    if (posts.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, posts.data, {
        total: posts.total,
        page: posts.page,
        limit: posts.limit,
        totalPages: posts.totalPages,
      });
    } else {
      res.json(posts);
    }
  };

  getLikedPostsByUserPublicId = async (
    req: TypedRequest<PostPublicIdParams, EmptyBody, UserPostsQuery>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { page, limit, sortBy, sortOrder } = req.query;
    const viewerPublicId = req.decodedUser?.publicId;

    const query = new GetLikedPostsByUserQuery(
      asUserPublicId(publicId),
      page,
      limit,
      viewerPublicId,
      sortBy,
      sortOrder,
    );
    const posts = await this.queryBus.execute<PaginationResult<PostDTO>>(query);

    if (posts.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, posts.data, {
        total: posts.total,
        page: posts.page,
        limit: posts.limit,
        totalPages: posts.totalPages,
      });
    } else {
      res.json(posts);
    }
  };

  getPostsByHandle = async (
    req: TypedRequest<UserHandleParams, EmptyBody, HandlePostsQuery>,
    res: Response,
  ): Promise<void> => {
    const { handle } = req.params;
    const { page, limit } = req.query;

    const userQuery = new GetUserByHandleQuery(handle);
    const user = await this.queryBus.execute<PublicUserDTO>(userQuery);

    const query = new GetPostsByUserQuery(user.publicId, page, limit);
    const posts = await this.queryBus.execute<PaginationResult<PostDTO>>(query);

    res.status(200).json(posts);
  };

  getPostBySlug = async (
    req: TypedRequest<SlugParams>,
    res: Response,
  ): Promise<void> => {
    const { slug } = req.params;
    const viewerPublicId = req.decodedUser?.publicId;
    const sanitizedSlug = slug.replace(FILE_EXTENSION_REGEX, "");
    const looksLikeUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        sanitizedSlug,
      );
    const post = looksLikeUUID
      ? await this.queryBus.execute<PostDTO>(
          new GetPostByPublicIdQuery(asPostPublicId(sanitizedSlug)),
        )
      : await this.queryBus.execute<PostDTO>(
          new GetPostBySlugQuery(sanitizedSlug),
        );

    if (viewerPublicId && post.publicId) {
      const command = new RecordPostViewCommand(post.publicId, viewerPublicId);
      safeFireAndForget(this.commandBus.dispatch(command));
    }

    res.status(200).json(post);
  };

  getPostByPublicId = async (
    req: TypedRequest<PostPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    logger.info("getPostByPublicId called");
    const { publicId } = req.params;
    const viewerPublicId = req.decodedUser?.publicId;
    // Strip file extension if present (e.g., "abc-123.png" -> "abc-123")
    const sanitizedPublicId = publicId.replace(FILE_EXTENSION_REGEX, "");
    const command = new GetPostByPublicIdQuery(
      asPostPublicId(sanitizedPublicId),
      viewerPublicId,
    );
    const postDTO = await this.queryBus.execute<PostDTO>(command);

    if (viewerPublicId) {
      safeFireAndForget(
        this.commandBus.dispatch(
          new RecordPostViewCommand(
            asPostPublicId(sanitizedPublicId),
            viewerPublicId,
          ),
        ),
      );
    }

    res.status(200).json(postDTO);
  };

  searchByTags = async (
    req: TypedRequest<EmptyParams, EmptyBody, SearchByTagsQueryParams>,
    res: Response,
  ): Promise<void> => {
    const { tags, page, limit } = req.query;
    const tagArray = tags.split(",").filter((tag) => tag.trim() !== "");

    const query = new SearchPostsByTagsQuery(tagArray, page, limit);
    const postDTO =
      await this.queryBus.execute<PaginationResult<PostDTO>>(query);

    if (postDTO.data.length >= STREAM_THRESHOLD) {
      streamPaginatedResponse(res, postDTO.data, {
        total: postDTO.total,
        page: postDTO.page,
        limit: postDTO.limit,
        totalPages: postDTO.totalPages,
      });
    } else {
      res.status(200).json(postDTO);
    }
  };

  listTags = async (_req: TypedRequest, res: Response): Promise<void> => {
    const query = new GetAllTagsQuery();
    const result = await this.queryBus.execute<ITag[]>(query);
    res.json(result);
  };

  deletePost = async (
    req: TypedRequest<PostPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("Authentication required");
    }

    const sanitizedPublicId = publicId.replace(FILE_EXTENSION_REGEX, "");
    const command = new DeletePostCommand(
      asPostPublicId(sanitizedPublicId),
      decodedUser.publicId,
    );
    const result = await this.commandBus.dispatch(command);
    res.status(200).json(result);
  };

  repostPost = async (
    req: TypedRequest<PostPublicIdParams, RepostBody>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User authentication required");
    }

    const sanitizedPublicId = publicId.replace(FILE_EXTENSION_REGEX, "");
    const { body } = req.body;
    const command = new RepostPostCommand(
      decodedUser.publicId,
      asPostPublicId(sanitizedPublicId),
      body,
    );
    const postDTO = await this.commandBus.dispatch<PostDTO>(command);
    res.status(201).json(postDTO);
  };

  unrepostPost = async (
    req: TypedRequest<PostPublicIdParams>,
    res: Response,
  ): Promise<void> => {
    const { publicId } = req.params;
    const { decodedUser } = req;

    if (!decodedUser || !decodedUser.publicId) {
      throw Errors.authentication("User authentication required");
    }

    const sanitizedPublicId = publicId.replace(FILE_EXTENSION_REGEX, "");
    const command = new UnrepostPostCommand(
      decodedUser.publicId,
      asPostPublicId(sanitizedPublicId),
    );
    const result = await this.commandBus.dispatch(command);
    res.status(200).json(result);
  };
}
