import { container } from "tsyringe";

import { SearchController } from "../controllers/search.controller";
import { AuthController } from "../controllers/auth.controller";
import { ProfileController } from "../controllers/profile.controller";
import { SocialController } from "../controllers/social.controller";
import { UserQueryController } from "../controllers/userQuery.controller";
import { ImageController } from "../controllers/image.controller";
import { PostController } from "../controllers/post.controller";
import { CommentController } from "../controllers/comment.controller";
import { NotificationController } from "../controllers/notification.controller";
import { AdminUserController } from "../controllers/admin.controller";
import { FeedController } from "../controllers/feed.controller";
import { FavoriteController } from "../controllers/favorite.controller";
import { MessagingController } from "../controllers/messaging.controller";
import { CommunityController } from "../controllers/community.controller";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export function registerControllers(): void {
  container.registerSingleton(TOKENS.Controllers.Search, SearchController);
  container.registerSingleton(TOKENS.Controllers.Auth, AuthController);
  container.registerSingleton(TOKENS.Controllers.Profile, ProfileController);
  container.registerSingleton(TOKENS.Controllers.Social, SocialController);
  container.registerSingleton(
    TOKENS.Controllers.UserQuery,
    UserQueryController,
  );
  container.registerSingleton(TOKENS.Controllers.Image, ImageController);
  container.registerSingleton(TOKENS.Controllers.Post, PostController);
  container.registerSingleton(TOKENS.Controllers.Comment, CommentController);
  container.registerSingleton(
    TOKENS.Controllers.Notification,
    NotificationController,
  );
  container.registerSingleton(
    TOKENS.Controllers.AdminUser,
    AdminUserController,
  );
  container.registerSingleton(TOKENS.Controllers.Feed, FeedController);
  container.registerSingleton(TOKENS.Controllers.Favorite, FavoriteController);
  container.registerSingleton(
    TOKENS.Controllers.Messaging,
    MessagingController,
  );
  container.registerSingleton(
    TOKENS.Controllers.Community,
    CommunityController,
  );

  logger.info("[di] Controllers registered");
}
