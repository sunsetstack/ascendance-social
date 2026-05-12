import { container } from "tsyringe";

import { UnitOfWork } from "@/database/UnitOfWork";
import { UserRepository } from "@/repositories/user.repository";
import { ImageRepository } from "@/repositories/image.repository";
import { PostRepository } from "@/repositories/post.repository";
import { PostLikeRepository } from "@/repositories/postLike.repository";
import { PostViewRepository } from "@/repositories/postView.repository";
import { CommentRepository } from "@/repositories/comment.repository";
import { CommentLikeRepository } from "@/repositories/commentLike.repository";
import { UserActionRepository } from "@/repositories/userAction.repository";
import { TagRepository } from "@/repositories/tag.repository";
import { FollowRepository } from "@/repositories/follow.repository";
import { NotificationRepository } from "@/repositories/notification.repository";
import { UserPreferenceRepository } from "@/repositories/userPreference.repository";
import { FavoriteRepository } from "@/repositories/favorite.repository";
import { ConversationRepository } from "@/repositories/conversation.repository";
import { MessageRepository } from "@/repositories/message.repository";
import { PostReadRepository } from "@/repositories/read/PostReadRepository";
import { UserReadRepository } from "@/repositories/read/UserReadRepository";
import { FeedReadDao } from "@/repositories/read/FeedReadDao";
import { PostWriteRepository } from "@/repositories/write/PostWriteRepository";
import { UserWriteRepository } from "@/repositories/write/UserWriteRepository";
import { CommunityRepository } from "@/repositories/community.repository";
import { CommunityMemberRepository } from "@/repositories/communityMember.repository";
import { RequestLogRepository } from "@/repositories/requestLog.repository";
import { OutboxRepository } from "@/repositories/outbox.repository";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export function registerRepositories(): void {
  container.registerSingleton(TOKENS.Repositories.UnitOfWork, UnitOfWork);
  container.registerSingleton(TOKENS.Repositories.User, UserRepository);
  container.registerSingleton(TOKENS.Repositories.Image, ImageRepository);
  container.registerSingleton(TOKENS.Repositories.Post, PostRepository);
  container.registerSingleton(TOKENS.Repositories.PostLike, PostLikeRepository);
  container.registerSingleton(TOKENS.Repositories.PostView, PostViewRepository);
  container.registerSingleton(TOKENS.Repositories.Comment, CommentRepository);
  container.registerSingleton(
    TOKENS.Repositories.CommentLike,
    CommentLikeRepository,
  );
  container.registerSingleton(
    TOKENS.Repositories.UserAction,
    UserActionRepository,
  );
  container.registerSingleton(TOKENS.Repositories.Tag, TagRepository);
  container.registerSingleton(TOKENS.Repositories.Follow, FollowRepository);
  container.registerSingleton(
    TOKENS.Repositories.Notification,
    NotificationRepository,
  );
  container.registerSingleton(
    TOKENS.Repositories.UserPreference,
    UserPreferenceRepository,
  );
  container.registerSingleton(TOKENS.Repositories.Favorite, FavoriteRepository);
  container.registerSingleton(
    TOKENS.Repositories.Conversation,
    ConversationRepository,
  );
  container.registerSingleton(TOKENS.Repositories.Message, MessageRepository);
  container.registerSingleton(
    TOKENS.Repositories.Community,
    CommunityRepository,
  );
  container.registerSingleton(
    TOKENS.Repositories.CommunityMember,
    CommunityMemberRepository,
  );
  container.registerSingleton(
    TOKENS.Repositories.RequestLog,
    RequestLogRepository,
  );
  container.registerSingleton(TOKENS.Repositories.Outbox, OutboxRepository);

  container.registerSingleton(TOKENS.Repositories.PostRead, PostReadRepository);
  container.registerSingleton(TOKENS.Repositories.UserRead, UserReadRepository);
  container.registerSingleton(
    TOKENS.Repositories.PostWrite,
    PostWriteRepository,
  );
  container.registerSingleton(
    TOKENS.Repositories.UserWrite,
    UserWriteRepository,
  );
  container.registerSingleton(TOKENS.Repositories.FeedReadDao, FeedReadDao);

  logger.info("[di] Repositories registered");
}
