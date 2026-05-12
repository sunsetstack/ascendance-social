import { container } from "tsyringe";

import { CloudinaryService } from "@/services/cloudinary.service";
import { AuthService } from "@/services/auth.service";
import { ImageService } from "@/services/image.service";
import { CommentService } from "@/services/comment.service";
import { NotificationService } from "@/services/notification.service";
import { DTOService } from "@/services/dto.service";
import { FeedService } from "@/services/feed/feed.service";
import { RedisService } from "@/services/redis.service";
import { UserActionService } from "@/services/userAction.service";
import { RealTimeFeedService } from "@/services/feed/real-time-feed.service";
import { FavoriteService } from "@/services/favorite.service";
import { MessagingService } from "@/services/messaging.service";
import { TagService } from "@/services/tag.service";
import { LocalStorageService } from "@/services/localStorage.service";
import { UserActivityService } from "@/services/user-activity.service";
import type { IImageStorageService } from "@/types";
import { NewPostMessageHandler } from "@/application/handlers/realtime/NewPostMessageHandler";
import { GlobalNewPostMessageHandler } from "@/application/handlers/realtime/GlobalNewPostMessageHandler";
import { PostDeletedMessageHandler } from "@/application/handlers/realtime/PostDeletedMessageHandler";
import { InteractionMessageHandler } from "@/application/handlers/realtime/InteractionMessageHandler";
import { LikeUpdateMessageHandler } from "@/application/handlers/realtime/LikeUpdateMessageHandler";
import { AvatarUpdateMessageHandler } from "@/application/handlers/realtime/AvatarUpdateMessageHandler";
import { MessageSentHandler as RealtimeMessageSentHandler } from "@/application/handlers/realtime/MessageSentHandler";
import { MessageStatusUpdatedHandler as RealtimeMessageStatusUpdatedHandler } from "@/application/handlers/realtime/MessageStatusUpdatedHandler";
import { SearchService } from "@/services/search.service";
import { logger } from "@/utils/winston";
import { MetricsService } from "../metrics/metrics.service";
import { RetryService } from "@/services/retry.service";
import { TransactionQueueService } from "@/services/transaction-queue.service";
import { TelemetryService } from "@/services/telemetry.service";
import { EmailService } from "@/services/email.service";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { AuthSessionService } from "@/services/auth-session.service";
import { BloomFilterService } from "@/services/redis/bloom-filter.service";
import { FeedCoreService } from "@/services/feed/feed-core.service";
import { FeedReadService } from "@/services/feed/feed-read.service";
import { FeedInteractionService } from "@/services/feed/feed-interaction.service";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { FeedFanoutService } from "@/services/feed/feed-fanout.service";
import { TOKENS } from "@/types/tokens";

export function registerServices(): void {
  const isCloudinaryConfigured =
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET;

  const ImageStorageService = isCloudinaryConfigured
    ? CloudinaryService
    : LocalStorageService;
  if (!isCloudinaryConfigured) {
    logger.info(
      "No Cloudinary credentials detected. \r\nDefaulting to local storage.",
    );
  }

  container.registerSingleton(TOKENS.Services.Metrics, MetricsService);
  container.registerSingleton(TOKENS.Services.Telemetry, TelemetryService);
  container.registerSingleton(TOKENS.Services.Search, SearchService);
  container.registerSingleton(TOKENS.Services.Auth, AuthService);
  container.registerSingleton(TOKENS.Services.AuthSession, AuthSessionService);
  container.registerSingleton(TOKENS.Services.BloomFilter, BloomFilterService);
  container.registerSingleton(TOKENS.Services.Image, ImageService);
  container.registerSingleton(TOKENS.Services.Comment, CommentService);
  container.registerSingleton(
    TOKENS.Services.Notification,
    NotificationService,
  );
  container.registerSingleton<IImageStorageService>(
    TOKENS.Services.ImageStorage,
    ImageStorageService,
  );
  container.registerSingleton(TOKENS.Services.DTO, DTOService);
  container.registerSingleton(
    TOKENS.Services.FeedEnrichment,
    FeedEnrichmentService,
  );
  container.registerSingleton(TOKENS.Services.FeedCore, FeedCoreService);
  container.registerSingleton(TOKENS.Services.FeedRead, FeedReadService);
  container.registerSingleton(
    TOKENS.Services.FeedInteraction,
    FeedInteractionService,
  );
  container.registerSingleton(TOKENS.Services.FeedMeta, FeedMetaService);
  container.registerSingleton(TOKENS.Services.FeedFanout, FeedFanoutService);
  container.registerSingleton(TOKENS.Services.Feed, FeedService);
  container.registerSingleton(TOKENS.Services.Redis, RedisService);
  container.registerSingleton(TOKENS.Services.UserAction, UserActionService);
  container.registerSingleton(
    TOKENS.Services.UserActivity,
    UserActivityService,
  );
  container.registerSingleton(TOKENS.Services.Retry, RetryService);
  container.registerSingleton(
    TOKENS.Services.TransactionQueue,
    TransactionQueueService,
  );
  container.registerSingleton(TOKENS.Services.Email, EmailService);

  const realtimeHandlers = [
    container.resolve(NewPostMessageHandler),
    container.resolve(GlobalNewPostMessageHandler),
    container.resolve(PostDeletedMessageHandler),
    container.resolve(InteractionMessageHandler),
    container.resolve(LikeUpdateMessageHandler),
    container.resolve(AvatarUpdateMessageHandler),
    container.resolve(RealtimeMessageSentHandler),
    container.resolve(RealtimeMessageStatusUpdatedHandler),
  ];
  container.register(TOKENS.Services.Realtime, { useValue: realtimeHandlers });

  container.registerSingleton(
    TOKENS.Services.RealTimeFeed,
    RealTimeFeedService,
  );
  container.registerSingleton(TOKENS.Services.Favorite, FavoriteService);
  container.registerSingleton(TOKENS.Services.Messaging, MessagingService);
  container.registerSingleton(TOKENS.Services.Tag, TagService);

  logger.info("[di] Services registered");
}
