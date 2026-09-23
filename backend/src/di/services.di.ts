import { container } from "tsyringe";

import { CloudinaryService } from "@/services/cloudinary.service";
import { AuthService } from "@/services/auth.service";
import { ImageService } from "@/services/image.service";
import { CommentService } from "@/services/comment.service";
import { DTOService } from "@/services/dto.service";
import { FeedService } from "@/services/feed/feed.service";
import { RedisService } from "@/services/redis.service";
import { UserActionService } from "@/services/userAction.service";
import { RealTimeFeedService } from "@/services/feed/real-time-feed.service";
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
import { NotificationMessageHandler } from "@/application/handlers/realtime/NotificationMessageHandler";
import { logger } from "@/utils/winston";
import { MetricsService } from "../metrics/metrics.service";
import { RetryService } from "@/services/retry.service";
import { TransactionQueueService } from "@/services/transaction-queue.service";
import { TelemetryService } from "@/services/telemetry.service";
import { EmailService } from "@/services/email.service";
import { FeedEnrichmentService } from "@/services/feed/feed-enrichment.service";
import { AuthSessionService } from "@/services/auth-session.service";
import { BloomFilterService } from "@/services/redis/bloom-filter.service";
import { SecurityAuditService } from "@/services/security-audit.service";
import { ForensicOperationalErrorService } from "@/services/forensic-operational-error.service";
import { FeedCoreService } from "@/services/feed/feed-core.service";
import { FeedReadService } from "@/services/feed/feed-read.service";
import { FeedInteractionService } from "@/services/feed/feed-interaction.service";
import { FeedMetaService } from "@/services/feed/feed-meta.service";
import { FeedFanoutService } from "@/services/feed/feed-fanout.service";
import { AuthMiddlewareService } from "@/middleware/authentication.middleware";
import { TOKENS } from "@/types/tokens";
import { AccountAuditSnapshotService } from "@/services/lifecycle/account-audit-snapshot.service";
import { AccountLifecycleService } from "@/services/lifecycle/account-lifecycle.service";
import { AdminRemovalGuardService } from "@/services/admin-removal-guard.service";
import { ContentCleanupService } from "@/services/lifecycle/content-cleanup.service";
import { MongoAccountCommunityCleanupParticipant } from "@/services/lifecycle/account-community-cleanup.participant";
import { MongoAccountContentCleanupParticipant } from "@/services/lifecycle/account-content-cleanup.participant";
import { MongoAccountConversationCleanupParticipant } from "@/services/lifecycle/account-conversation-cleanup.participant";
import { EventBusAccountOutboxParticipant } from "@/services/lifecycle/account-outbox.participant";
import { MongoAccountRecordCleanupParticipant } from "@/services/lifecycle/account-record-cleanup.participant";
import { MongoAccountSocialCleanupParticipant } from "@/services/lifecycle/account-social-cleanup.participant";
import { RedisAuthSessionStore } from "@/services/redis/capabilities/redis-auth-session.store";
import { RedisFeedCache } from "@/services/redis/capabilities/redis-feed-cache";
import { RedisUserLookup } from "@/services/redis/capabilities/redis-user-lookup";
import { RedisUserSuggestions } from "@/services/redis/capabilities/redis-user-suggestions";
import {
  RedisTrendingCacheStore,
  RedisTrendingStreamStore,
} from "@/workers/trending/redis-trending.store";
import { TrendingStreamConsumer } from "@/workers/trending/trending-stream.consumer";
import { TrendingProjectionService } from "@/workers/trending/trending-projection.service";
import type {
  ITrendingCacheStore,
  ITrendingProjectionService,
  ITrendingStreamConsumer,
  ITrendingStreamStore,
} from "@/workers/trending/trending.ports";
import type { AuthSessionStore } from "@/application/ports/auth-session-store";
import type { FeedCache } from "@/application/ports/feed-cache";
import type { UserLookup } from "@/application/ports/user-lookup";
import type { UserSuggestions } from "@/application/ports/user-suggestions";
import type {
  AccountCommunityCleanupParticipant,
  AccountContentCleanupParticipant,
  AccountConversationCleanupParticipant,
  AccountOutboxParticipant,
  AccountRecordCleanupParticipant,
  AccountSocialCleanupParticipant,
} from "@/services/lifecycle/account-lifecycle.ports";

export function registerServices(): void {
  const isCloudinaryConfigured = [
    process.env.CLOUDINARY_CLOUD_NAME,
    process.env.CLOUDINARY_API_KEY,
    process.env.CLOUDINARY_API_SECRET,
  ].every((value) => typeof value === "string" && value.trim().length > 0);

  const ImageStorageService = isCloudinaryConfigured
    ? CloudinaryService
    : LocalStorageService;
  if (!isCloudinaryConfigured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Cloudinary credentials are required when NODE_ENV=production",
      );
    }
    logger.info(
      "No Cloudinary credentials detected. Defaulting to local storage.",
    );
  }

  container.registerSingleton(TOKENS.Services.Metrics, MetricsService);
  container.registerSingleton(
    TOKENS.Services.ContentCleanup,
    ContentCleanupService,
  );
  container.registerSingleton<AccountContentCleanupParticipant>(
    TOKENS.Services.AccountContentCleanup,
    MongoAccountContentCleanupParticipant,
  );
  container.registerSingleton<AccountSocialCleanupParticipant>(
    TOKENS.Services.AccountSocialCleanup,
    MongoAccountSocialCleanupParticipant,
  );
  container.registerSingleton<AccountConversationCleanupParticipant>(
    TOKENS.Services.AccountConversationCleanup,
    MongoAccountConversationCleanupParticipant,
  );
  container.registerSingleton<AccountCommunityCleanupParticipant>(
    TOKENS.Services.AccountCommunityCleanup,
    MongoAccountCommunityCleanupParticipant,
  );
  container.registerSingleton<AccountRecordCleanupParticipant>(
    TOKENS.Services.AccountRecordCleanup,
    MongoAccountRecordCleanupParticipant,
  );
  container.registerSingleton<AccountOutboxParticipant>(
    TOKENS.Services.AccountOutbox,
    EventBusAccountOutboxParticipant,
  );
  container.registerSingleton(
    TOKENS.Services.AccountLifecycle,
    AccountLifecycleService,
  );
  container.registerSingleton(
    TOKENS.Services.AdminRemovalGuard,
    AdminRemovalGuardService,
  );
  container.registerSingleton(
    TOKENS.Services.AccountAuditSnapshot,
    AccountAuditSnapshotService,
  );
  container.registerSingleton(TOKENS.Services.Telemetry, TelemetryService);
  container.registerSingleton(TOKENS.Services.Auth, AuthService);
  container.registerSingleton(
    TOKENS.Services.AuthMiddleware,
    AuthMiddlewareService,
  );
  container.registerSingleton(TOKENS.Services.AuthSession, AuthSessionService);
  container.registerSingleton(TOKENS.Services.BloomFilter, BloomFilterService);
  container.registerSingleton(TOKENS.Services.Image, ImageService);
  container.registerSingleton(TOKENS.Services.Comment, CommentService);
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
  container.registerSingleton<AuthSessionStore>(
    TOKENS.Services.AuthSessionStore,
    RedisAuthSessionStore,
  );
  container.registerSingleton<FeedCache>(
    TOKENS.Services.FeedCache,
    RedisFeedCache,
  );
  container.registerSingleton<UserLookup>(
    TOKENS.Services.UserLookup,
    RedisUserLookup,
  );
  container.registerSingleton<UserSuggestions>(
    TOKENS.Services.UserSuggestions,
    RedisUserSuggestions,
  );
  container.registerSingleton<ITrendingStreamStore>(
    TOKENS.Services.TrendingStreamStore,
    RedisTrendingStreamStore,
  );
  container.registerSingleton<ITrendingCacheStore>(
    TOKENS.Services.TrendingCacheStore,
    RedisTrendingCacheStore,
  );
  container.registerSingleton<ITrendingStreamConsumer>(
    TOKENS.Services.TrendingStreamConsumer,
    TrendingStreamConsumer,
  );
  container.registerSingleton<ITrendingProjectionService>(
    TOKENS.Services.TrendingProjection,
    TrendingProjectionService,
  );
  container.registerSingleton(TOKENS.Services.UserAction, UserActionService);
  container.registerSingleton(
    TOKENS.Services.SecurityAudit,
    SecurityAuditService,
  );
  container.registerSingleton(
    TOKENS.Services.ForensicOperationalError,
    ForensicOperationalErrorService,
  );
  container.registerSingleton(
    TOKENS.Services.UserActivity,
    UserActivityService,
  );
  container.registerSingleton(TOKENS.Services.Retry, RetryService);
  container.registerSingleton(
    TOKENS.Services.TransactionQueue,
    TransactionQueueService,
  );
  if (process.env.ENABLE_API === "false") {
    container.registerSingleton(TOKENS.Services.Email, EmailService);
  } else {
    container.registerInstance(TOKENS.Services.Email, new EmailService());
  }

  const realtimeHandlers = [
    container.resolve(NewPostMessageHandler),
    container.resolve(GlobalNewPostMessageHandler),
    container.resolve(PostDeletedMessageHandler),
    container.resolve(InteractionMessageHandler),
    container.resolve(LikeUpdateMessageHandler),
    container.resolve(AvatarUpdateMessageHandler),
    container.resolve(RealtimeMessageSentHandler),
    container.resolve(RealtimeMessageStatusUpdatedHandler),
    container.resolve(NotificationMessageHandler),
  ];
  container.register(TOKENS.Services.Realtime, { useValue: realtimeHandlers });

  container.registerSingleton(
    TOKENS.Services.RealTimeFeed,
    RealTimeFeedService,
  );
  container.registerSingleton(TOKENS.Services.Tag, TagService);

  logger.info("[di] Services registered");
}
