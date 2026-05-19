import express from "express";
import { asyncHandler } from "@/middleware/async-handler.middleware";
import { ImageController } from "../controllers/image.controller";
import { ValidationMiddleware } from "../middleware/validation.middleware";
import {
  createPostSchema,
  handlePostsQuerySchema,
  listPostsQuerySchema,
  slugSchema,
  publicIdSchema,
  searchByTagsSchema,
  userPostsQuerySchema,
} from "@/utils/schemas/post.schemas";
import { handleSchema } from "@/utils/schemas/user.schemas";
import upload from "@/config/multer";
import { AuthFactory } from "../middleware/authentication.middleware";
import { inject, injectable } from "tsyringe";
import { TOKENS } from "@/types/tokens";

@injectable()
export class ImageRoutes {
  public router: express.Router;
  private auth = AuthFactory.bearerToken().handle();
  private optionalAuth = AuthFactory.optionalBearerToken().handleOptional();

  constructor(
    @inject(TOKENS.Controllers.Image) private controller: ImageController,
  ) {
    this.router = express.Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.get(
      "/",
      new ValidationMiddleware({ query: listPostsQuerySchema }).validate(),
      asyncHandler(this.controller.listPosts),
    );

    // Use slug for SEO-friendly image URLs (optional auth to check if user liked)
    this.router.get(
      "/image/:slug",
      this.optionalAuth,
      new ValidationMiddleware({ params: slugSchema }).validate(),
      asyncHandler(this.controller.getPostBySlug),
    );

    // Public: get image by publicId (optional auth to check if user liked)
    this.router.get(
      "/public/:publicId",
      this.optionalAuth,
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.controller.getPostByPublicId),
    );

    // Use handle for profile image galleries (public endpoint)
    this.router.get(
      "/user/handle/:handle",
      new ValidationMiddleware({ query: handlePostsQuerySchema }).validate(),
      new ValidationMiddleware({ params: handleSchema }).validate(),
      asyncHandler(this.controller.getPostsByHandle),
    );
    this.router.get(
      "/user/id/:publicId",
      new ValidationMiddleware({ query: userPostsQuerySchema }).validate(),
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.controller.getPostsByUserPublicId),
    );

    this.router.get(
      "/search/tags",
      new ValidationMiddleware({ query: searchByTagsSchema }).validate(),
      asyncHandler(this.controller.searchByTags),
    );

    this.router.get("/tags", asyncHandler(this.controller.listTags));

    // === PROTECTED ROUTES (require authentication) ===
    this.router.use(this.auth);

    this.router.post(
      "/upload",
      upload.single("image"),
      new ValidationMiddleware({ body: createPostSchema }).validate(),
      asyncHandler(this.controller.createPost),
    );

    this.router.delete(
      "/image/:publicId",
      new ValidationMiddleware({ params: publicIdSchema }).validate(),
      asyncHandler(this.controller.deletePost),
    );
  }
  public getRouter(): express.Router {
    return this.router;
  }
}
