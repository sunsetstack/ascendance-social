import express from "express";
import { RequestHandler } from "express";
import { inject, injectable } from "tsyringe";
import { PostController } from "../controllers/post.controller";
import { AuthMiddlewareService } from "../middleware/authentication.middleware";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import {
  createPostSchema,
  listPostsQuerySchema,
  handlePostsQuerySchema,
  publicIdSchema,
  slugSchema,
  searchByTagsSchema,
  repostSchema,
  userPostsQuerySchema,
} from "@/utils/schemas/post.schemas";
import { handleSchema } from "@/utils/schemas/user.schemas";
import upload, { validateImageUpload } from "@/config/multer";
import { TOKENS } from "@/types/tokens";

@injectable()
export class PostRoutes {
  private readonly router = express.Router();
  private readonly auth: RequestHandler;
  private readonly optionalAuth: RequestHandler;

  constructor(
    @inject(TOKENS.Controllers.Post)
    private readonly postController: PostController,
    @inject(TOKENS.Services.AuthMiddleware)
    authMiddlewareService: AuthMiddlewareService,
  ) {
    this.auth = authMiddlewareService.required();
    this.optionalAuth = authMiddlewareService.optional();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(
      "/",
      this.optionalAuth,
      new ValidationMiddleware({ query: listPostsQuerySchema }).validate(),
      asyncHandler(this.postController.listPosts),
    );

    this.router.get(
      "/slug/:slug",
      this.optionalAuth,
      new ValidationMiddleware({ params: slugSchema }).validate(),
      asyncHandler(this.postController.getPostBySlug),
    );

    this.router.get(
      "/:publicId",
      this.optionalAuth,
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.postController.getPostByPublicId),
    );

    this.router.get(
      "/user/handle/:handle",
      new ValidationMiddleware({ query: handlePostsQuerySchema }).validate(),
      new ValidationMiddleware({ params: handleSchema }).validate(),
      asyncHandler(this.postController.getPostsByHandle),
    );

    this.router.get(
      "/user/:publicId",
      new ValidationMiddleware({ query: userPostsQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.postController.getPostsByUserPublicId),
    );

    this.router.get(
      "/user/:publicId/likes",
      new ValidationMiddleware({ query: userPostsQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.postController.getLikedPostsByUserPublicId),
    );

    this.router.get(
      "/search/tags",
      new ValidationMiddleware({ query: searchByTagsSchema }).validate(),
      asyncHandler(this.postController.searchByTags),
    );
    this.router.get("/tags", asyncHandler(this.postController.listTags));

    this.router.use(this.auth);
    this.router.post(
      "/",
      upload.single("image"),
      validateImageUpload,
      new ValidationMiddleware({ body: createPostSchema }).validate(),
      asyncHandler(this.postController.createPost),
    );
    this.router.post(
      "/:publicId/repost",
      new ValidationMiddleware({
        params: publicIdSchema,
        body: repostSchema,
      }).validate(),
      asyncHandler(this.postController.repostPost),
    );
    this.router.delete(
      "/:publicId/repost",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.postController.unrepostPost),
    );
    this.router.delete(
      "/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.postController.deletePost),
    );
  }

  public getRouter(): express.Router {
    return this.router;
  }
}
