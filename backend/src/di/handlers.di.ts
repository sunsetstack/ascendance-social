import { container } from "tsyringe";

import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { EventBus } from "@/application/common/buses/event.bus";
import { FollowUserCommand } from "@/application/commands/users/followUser/followUser.command";
import { FollowUserCommandHandler } from "@/application/commands/users/followUser/followUser.handler";
import { RegisterUserCommandHandler } from "@/application/commands/users/register/register.handler";
import { RegisterUserCommand } from "@/application/commands/users/register/register.command";
import { GetDashboardStatsQuery } from "@/application/queries/admin/getDashboardStats/getDashboardStats.query";
import { GetDashboardStatsQueryHandler } from "@/application/queries/admin/getDashboardStats/getDashboardStats.handler";
import { GetMeQueryHandler } from "@/application/queries/users/getMe/getMe.handler";
import { GetMeQuery } from "@/application/queries/users/getMe/getMe.query";
import { GetAccountInfoQueryHandler } from "@/application/queries/users/getAccountInfo/getAccountInfo.handler";
import { GetAccountInfoQuery } from "@/application/queries/users/getAccountInfo/getAccountInfo.query";
import { GetWhoToFollowQueryHandler } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.handler";
import { GetWhoToFollowQuery } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.query";
import { GetHandleSuggestionsQueryHandler } from "@/application/queries/users/getHandleSuggestions/getHandleSuggestions.handler";
import { GetHandleSuggestionsQuery } from "@/application/queries/users/getHandleSuggestions/getHandleSuggestions.query";
import { GetTrendingTagsQueryHandler } from "@/application/queries/tags/getTrendingTags/getTrendingTags.handler";
import { GetTrendingTagsQuery } from "@/application/queries/tags/getTrendingTags/getTrendingTags.query";
import { FeedInteractionHandler } from "@/application/events/user/feed-interaction.handler";
import { UserInteractedWithPostEvent } from "@/application/events/user/user-interaction.event";
import {
  PostDeletedEvent,
  PostUploadedEvent,
} from "@/application/events/post/post.event";
import { LikeActionCommand } from "@/application/commands/users/likeAction/likeAction.command";
import { LikeActionCommandHandler } from "@/application/commands/users/likeAction/likeAction.handler";
import { LikeActionByPublicIdCommand } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.command";
import { LikeActionByPublicIdCommandHandler } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.handler";
import { PostUploadHandler } from "@/application/events/post/post-uploaded.handler";
import { PostDeleteHandler } from "@/application/events/post/post-deleted.handler";
import {
  UserAvatarChangedEvent,
  UserUsernameChangedEvent,
} from "@/application/events/user/user-interaction.event";
import { UserAvatarChangedHandler } from "@/application/events/user/user-avatar-change.handler";
import { UserUsernameChangedHandler } from "@/application/events/user/user-username-change.handler";
import { CreateCommentCommand } from "@/application/commands/comments/createComment/createComment.command";
import { CreateCommentCommandHandler } from "@/application/commands/comments/createComment/create-comment.handler";
import { DeleteCommentCommand } from "@/application/commands/comments/deleteComment/deleteComment.command";
import { DeleteCommentCommandHandler } from "@/application/commands/comments/deleteComment/delete-comment.handler";
import { LikeCommentCommand } from "@/application/commands/comments/likeComment/likeComment.command";
import { LikeCommentCommandHandler } from "@/application/commands/comments/likeComment/like-comment.handler";
import { MessageSentHandler } from "@/application/events/message/message-sent.handler";
import { MessageStatusUpdatedHandler as MessageStatusUpdatedEventHandler } from "@/application/events/message/message-status-updated.handler";
import { MessageAttachmentsDeletedHandler } from "@/application/handlers/message/MessageAttachmentsDeletedHandler";
import {
  MessageSentEvent,
  MessageStatusUpdatedEvent,
  MessageAttachmentsDeletedEvent,
} from "@/application/events/message/message.event";
import { NotificationRequestedEvent } from "@/application/events/notification/notification.event";
import { NotificationRequestedHandler } from "@/application/events/notification/notification-requested.handler";
import { CreatePostCommand } from "@/application/commands/post/createPost/createPost.command";
import { CreatePostCommandHandler } from "@/application/commands/post/createPost/createPost.handler";
import { DeletePostCommand } from "@/application/commands/post/deletePost/deletePost.command";
import { DeletePostCommandHandler } from "@/application/commands/post/deletePost/deletePost.handler";
import { RepostPostCommand } from "@/application/commands/post/repostPost/repostPost.command";
import { RepostPostCommandHandler } from "@/application/commands/post/repostPost/repostPost.handler";
import { UnrepostPostCommand } from "@/application/commands/post/unrepostPost/unrepostPost.command";
import { UnrepostPostCommandHandler } from "@/application/commands/post/unrepostPost/unrepostPost.handler";
import { RecordPostViewCommand } from "@/application/commands/post/recordPostView/recordPostView.command";
import { RecordPostViewCommandHandler } from "@/application/commands/post/recordPostView/recordPostView.handler";
import { GetPersonalizedFeedQuery } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.query";
import { GetPersonalizedFeedQueryHandler } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.handler";
import { GetPostByPublicIdQuery } from "@/application/queries/post/getPostByPublicId/getPostByPublicId.query";
import { GetPostByPublicIdQueryHandler } from "@/application/queries/post/getPostByPublicId/getPostByPublicId.handler";
import { GetPostBySlugQuery } from "@/application/queries/post/getPostBySlug/getPostBySlug.query";
import { GetPostBySlugQueryHandler } from "@/application/queries/post/getPostBySlug/getPostBySlug.handler";
import { GetPostsQuery } from "@/application/queries/post/getPosts/getPosts.query";
import { GetPostsQueryHandler } from "@/application/queries/post/getPosts/getPosts.handler";
import { GetAllPostsAdminQuery } from "@/application/queries/post/getAllPostsAdmin/getAllPostsAdmin.query";
import { GetAllPostsAdminQueryHandler } from "@/application/queries/post/getAllPostsAdmin/getAllPostsAdmin.handler";
import { GetPostsByUserQuery } from "@/application/queries/post/getPostsByUser/getPostsByUser.query";
import { GetPostsByUserQueryHandler } from "@/application/queries/post/getPostsByUser/getPostsByUser.handler";
import { SearchPostsByTagsQuery } from "@/application/queries/post/searchPostsByTags/searchPostsByTags.query";
import { SearchPostsByTagsQueryHandler } from "@/application/queries/post/searchPostsByTags/searchPostsByTags.handler";
import { GetAllTagsQuery } from "@/application/queries/tags/getAllTags/getAllTags.query";
import { GetAllTagsQueryHandler } from "@/application/queries/tags/getAllTags/getAllTags.handler";
import { GetLikedPostsByUserQuery } from "@/application/queries/post/getLikedPostsByUser/getLikedPostsByUser.query";
import { GetLikedPostsByUserHandler } from "@/application/queries/post/getLikedPostsByUser/getLikedPostsByUser.handler";
import { NewPostMessageHandler } from "@/application/handlers/realtime/NewPostMessageHandler";
import { GlobalNewPostMessageHandler } from "@/application/handlers/realtime/GlobalNewPostMessageHandler";
import { PostDeletedMessageHandler } from "@/application/handlers/realtime/PostDeletedMessageHandler";
import { InteractionMessageHandler } from "@/application/handlers/realtime/InteractionMessageHandler";
import { LikeUpdateMessageHandler } from "@/application/handlers/realtime/LikeUpdateMessageHandler";
import { AvatarUpdateMessageHandler } from "@/application/handlers/realtime/AvatarUpdateMessageHandler";
import { MessageSentHandler as RealtimeMessageSentHandler } from "@/application/handlers/realtime/MessageSentHandler";
import { MessageStatusUpdatedHandler as RealtimeMessageStatusUpdatedHandler } from "@/application/handlers/realtime/MessageStatusUpdatedHandler";
import { GetForYouFeedQueryHandler } from "@/application/queries/feed/getForYouFeed/getForYouFeed.handler";
import { GetForYouFeedQuery } from "@/application/queries/feed/getForYouFeed/getForYouFeed.query";
import { GetTrendingFeedQueryHandler } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.handler";
import { GetTrendingFeedQuery } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.query";
import { DeleteUserCommand } from "@/application/commands/users/deleteUser/deleteUser.command";
import { DeleteUserCommandHandler } from "@/application/commands/users/deleteUser/deleteUser.handler";
import { UpdateAvatarCommand } from "@/application/commands/users/updateAvatar/updateAvatar.command";
import { UpdateAvatarCommandHandler } from "@/application/commands/users/updateAvatar/updateAvatar.handler";
import { UpdateCoverCommand } from "@/application/commands/users/updateCover/updateCover.command";
import { UpdateCoverCommandHandler } from "@/application/commands/users/updateCover/updateCover.handler";
import {
  UserCoverChangedEvent,
  UserDeletedEvent,
} from "@/application/events/user/user-interaction.event";
import { UserCoverChangedHandler } from "@/application/events/user/user-cover-change.handler";
import { UserDeletedHandler } from "@/application/events/user/user-deleted.handler";
import { GetUserByPublicIdQuery } from "@/application/queries/users/getUserByPublicId/getUserByPublicId.query";
import { GetUserByPublicIdQueryHandler } from "@/application/queries/users/getUserByPublicId/getUserByPublicId.handler";
import { GetUserByHandleQuery } from "@/application/queries/users/getUserByUsername/getUserByUsername.query";
import { GetUserByHandleQueryHandler } from "@/application/queries/users/getUserByUsername/getUserByUsername.handler";
import { GetUsersQuery } from "@/application/queries/users/getUsers/getUsers.query";
import { GetUsersQueryHandler } from "@/application/queries/users/getUsers/getUsers.handler";
import { CheckFollowStatusQuery } from "@/application/queries/users/checkFollowStatus/checkFollowStatus.query";
import { CheckFollowStatusQueryHandler } from "@/application/queries/users/checkFollowStatus/checkFollowStatus.handler";
import { GetFollowersQuery } from "@/application/queries/users/getFollowers/getFollowers.query";
import { GetFollowersQueryHandler } from "@/application/queries/users/getFollowers/getFollowers.handler";
import { GetFollowingQuery } from "@/application/queries/users/getFollowing/getFollowing.query";
import { GetFollowingQueryHandler } from "@/application/queries/users/getFollowing/getFollowing.handler";
import { UpdateProfileCommand } from "@/application/commands/users/updateProfile/updateProfile.command";
import { UpdateProfileCommandHandler } from "@/application/commands/users/updateProfile/updateProfile.handler";
import { ChangePasswordCommand } from "@/application/commands/users/changePassword/changePassword.command";
import { ChangePasswordCommandHandler } from "@/application/commands/users/changePassword/changePassword.handler";
import { GetAllUsersAdminQuery } from "@/application/queries/admin/getAllUsersAdmin/getAllUsersAdmin.query";
import { GetAllUsersAdminQueryHandler } from "@/application/queries/admin/getAllUsersAdmin/getAllUsersAdmin.handler";
import { GetAdminUserProfileQuery } from "@/application/queries/admin/getAdminUserProfile/getAdminUserProfile.query";
import { GetAdminUserProfileQueryHandler } from "@/application/queries/admin/getAdminUserProfile/getAdminUserProfile.handler";
import { GetUserStatsQuery } from "@/application/queries/admin/getUserStats/getUserStats.query";
import { GetUserStatsQueryHandler } from "@/application/queries/admin/getUserStats/getUserStats.handler";
import { GetRecentActivityQuery } from "@/application/queries/admin/getRecentActivity/getRecentActivity.query";
import { GetRecentActivityQueryHandler } from "@/application/queries/admin/getRecentActivity/getRecentActivity.handler";
import { BanUserCommand } from "@/application/commands/admin/banUser/banUser.command";
import { BanUserCommandHandler } from "@/application/commands/admin/banUser/banUser.handler";
import { UnbanUserCommand } from "@/application/commands/admin/unbanUser/unbanUser.command";
import { UnbanUserCommandHandler } from "@/application/commands/admin/unbanUser/unbanUser.handler";
import { PromoteToAdminCommand } from "@/application/commands/admin/promoteToAdmin/promoteToAdmin.command";
import { PromoteToAdminCommandHandler } from "@/application/commands/admin/promoteToAdmin/promoteToAdmin.handler";
import { DemoteFromAdminCommand } from "@/application/commands/admin/demoteFromAdmin/demoteFromAdmin.command";
import { DemoteFromAdminCommandHandler } from "@/application/commands/admin/demoteFromAdmin/demoteFromAdmin.handler";
import { RequestPasswordResetHandler } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetHandler";
import { RequestPasswordResetCommand } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetCommand";
import { ResetPasswordHandler } from "@/application/commands/users/resetPassword/ResetPasswordHandler";
import { ResetPasswordCommand } from "@/application/commands/users/resetPassword/ResetPasswordCommand";
import { VerifyEmailHandler } from "@/application/commands/users/verifyEmail/VerifyEmailHandler";
import { VerifyEmailCommand } from "@/application/commands/users/verifyEmail/VerifyEmailCommand";
import { CreateCommunityCommand } from "@/application/commands/community/createCommunity/createCommunity.command";
import { CreateCommunityCommandHandler } from "@/application/commands/community/createCommunity/createCommunity.handler";
import { JoinCommunityCommand } from "@/application/commands/community/joinCommunity/joinCommunity.command";
import { JoinCommunityCommandHandler } from "@/application/commands/community/joinCommunity/joinCommunity.handler";
import { LeaveCommunityCommand } from "@/application/commands/community/leaveCommunity/leaveCommunity.command";
import { LeaveCommunityCommandHandler } from "@/application/commands/community/leaveCommunity/leaveCommunity.handler";
import { GetCommunityDetailsQuery } from "@/application/queries/community/getCommunityDetails/getCommunityDetails.query";
import { GetCommunityDetailsQueryHandler } from "@/application/queries/community/getCommunityDetails/getCommunityDetails.handler";
import { GetUserCommunitiesQuery } from "@/application/queries/community/getUserCommunities/getUserCommunities.query";
import { GetUserCommunitiesQueryHandler } from "@/application/queries/community/getUserCommunities/getUserCommunities.handler";
import { GetCommunityFeedQuery } from "@/application/queries/community/getCommunityFeed/getCommunityFeed.query";
import { GetCommunityFeedQueryHandler } from "@/application/queries/community/getCommunityFeed/getCommunityFeed.handler";
import { UpdateCommunityCommand } from "@/application/commands/community/updateCommunity/updateCommunity.command";
import { UpdateCommunityCommandHandler } from "@/application/commands/community/updateCommunity/updateCommunity.handler";
import { DeleteCommunityCommand } from "@/application/commands/community/deleteCommunity/deleteCommunity.command";
import { DeleteCommunityCommandHandler } from "@/application/commands/community/deleteCommunity/deleteCommunity.handler";
import { KickMemberCommand } from "@/application/commands/community/kickMember/kickMember.command";
import { KickMemberCommandHandler } from "@/application/commands/community/kickMember/kickMember.handler";
import { GetAllCommunitiesQuery } from "@/application/queries/community/getAllCommunities/getAllCommunities.query";
import { GetAllCommunitiesQueryHandler } from "@/application/queries/community/getAllCommunities/getAllCommunities.handler";
import { GetCommunityMembersQuery } from "@/application/queries/community/getCommunityMembers/getCommunityMembers.query";
import { GetCommunityMembersQueryHandler } from "@/application/queries/community/getCommunityMembers/getCommunityMembers.handler";
import { LogRequestCommand } from "@/application/commands/admin/logRequest/logRequest.command";
import { LogRequestCommandHandler } from "@/application/commands/admin/logRequest/logRequest.handler";
import { GetRequestLogsQuery } from "@/application/queries/admin/getRequestLogs/getRequestLogs.query";
import { GetRequestLogsQueryHandler } from "@/application/queries/admin/getRequestLogs/getRequestLogs.handler";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

export function registerCQRS(): void {
  container.registerSingleton(TOKENS.CQRS.Commands.Bus, CommandBus);
  container.registerSingleton(TOKENS.CQRS.Queries.Bus, QueryBus);
  container.registerSingleton(TOKENS.CQRS.Handlers.EventBus, EventBus);

  container.register(TOKENS.CQRS.Commands.RegisterUser, {
    useClass: RegisterUserCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.FollowUser, {
    useClass: FollowUserCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.DeleteUser, {
    useClass: DeleteUserCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.UpdateAvatar, {
    useClass: UpdateAvatarCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.UpdateCover, {
    useClass: UpdateCoverCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.UpdateProfile, {
    useClass: UpdateProfileCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.ChangePassword, {
    useClass: ChangePasswordCommandHandler,
  });

  container.register(TOKENS.CQRS.Commands.LikeAction, {
    useClass: LikeActionCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.LikeActionByPublicId, {
    useClass: LikeActionByPublicIdCommandHandler,
  });

  container.register(TOKENS.CQRS.Commands.CreateComment, {
    useClass: CreateCommentCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.DeleteComment, {
    useClass: DeleteCommentCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.LikeComment, {
    useClass: LikeCommentCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.CreatePost, {
    useClass: CreatePostCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.DeletePost, {
    useClass: DeletePostCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.RepostPost, {
    useClass: RepostPostCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.UnrepostPost, {
    useClass: UnrepostPostCommandHandler,
  });

  container.register(TOKENS.CQRS.Commands.RecordPostView, {
    useClass: RecordPostViewCommandHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetLikedPostsByUser, {
    useClass: GetLikedPostsByUserHandler,
  });

  container.register(TOKENS.CQRS.Commands.BanUser, {
    useClass: BanUserCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.UnbanUser, {
    useClass: UnbanUserCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.PromoteToAdmin, {
    useClass: PromoteToAdminCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.DemoteFromAdmin, {
    useClass: DemoteFromAdminCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.LogRequest, {
    useClass: LogRequestCommandHandler,
  });

  container.register(TOKENS.CQRS.Handlers.PostUpload, {
    useClass: PostUploadHandler,
  });
  container.register(TOKENS.CQRS.Handlers.PostDelete, {
    useClass: PostDeleteHandler,
  });
  container.register(TOKENS.CQRS.Handlers.UserAvatarChanged, {
    useClass: UserAvatarChangedHandler,
  });
  container.register(TOKENS.CQRS.Handlers.UserUsernameChanged, {
    useClass: UserUsernameChangedHandler,
  });
  container.register(TOKENS.CQRS.Handlers.UserCoverChanged, {
    useClass: UserCoverChangedHandler,
  });
  container.register(TOKENS.CQRS.Handlers.UserDeleted, {
    useClass: UserDeletedHandler,
  });
  container.register(TOKENS.CQRS.Handlers.RequestPasswordReset, {
    useClass: RequestPasswordResetHandler,
  });
  container.register(TOKENS.CQRS.Handlers.ResetPassword, {
    useClass: ResetPasswordHandler,
  });
  container.register(TOKENS.CQRS.Handlers.VerifyEmail, {
    useClass: VerifyEmailHandler,
  });

  container.register(TOKENS.CQRS.Commands.CreateCommunity, {
    useClass: CreateCommunityCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.JoinCommunity, {
    useClass: JoinCommunityCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.LeaveCommunity, {
    useClass: LeaveCommunityCommandHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetCommunityDetails, {
    useClass: GetCommunityDetailsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetUserCommunities, {
    useClass: GetUserCommunitiesQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetCommunityFeed, {
    useClass: GetCommunityFeedQueryHandler,
  });
  container.register(TOKENS.CQRS.Commands.UpdateCommunity, {
    useClass: UpdateCommunityCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.DeleteCommunity, {
    useClass: DeleteCommunityCommandHandler,
  });
  container.register(TOKENS.CQRS.Commands.KickMember, {
    useClass: KickMemberCommandHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetAllCommunities, {
    useClass: GetAllCommunitiesQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetCommunityMembers, {
    useClass: GetCommunityMembersQueryHandler,
  });

  container.register(TOKENS.CQRS.Queries.GetMe, {
    useClass: GetMeQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetAccountInfo, {
    useClass: GetAccountInfoQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetUserByPublicId, {
    useClass: GetUserByPublicIdQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetUserByHandle, {
    useClass: GetUserByHandleQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetUsers, {
    useClass: GetUsersQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.CheckFollowStatus, {
    useClass: CheckFollowStatusQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetFollowers, {
    useClass: GetFollowersQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetFollowing, {
    useClass: GetFollowingQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetDashboardStats, {
    useClass: GetDashboardStatsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetWhoToFollow, {
    useClass: GetWhoToFollowQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetHandleSuggestions, {
    useClass: GetHandleSuggestionsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetTrendingTags, {
    useClass: GetTrendingTagsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetPersonalizedFeed, {
    useClass: GetPersonalizedFeedQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetForYouFeed, {
    useClass: GetForYouFeedQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetTrendingFeed, {
    useClass: GetTrendingFeedQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetPostByPublicId, {
    useClass: GetPostByPublicIdQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetPostBySlug, {
    useClass: GetPostBySlugQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetPosts, {
    useClass: GetPostsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetPostsByUser, {
    useClass: GetPostsByUserQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.SearchPostsByTags, {
    useClass: SearchPostsByTagsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetAllTags, {
    useClass: GetAllTagsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetLikedPostsByUser, {
    useClass: GetLikedPostsByUserHandler,
  });

  container.register(TOKENS.CQRS.Queries.GetAllPostsAdmin, {
    useClass: GetAllPostsAdminQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetAllUsersAdmin, {
    useClass: GetAllUsersAdminQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetAdminUserProfile, {
    useClass: GetAdminUserProfileQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetUserStats, {
    useClass: GetUserStatsQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetRecentActivity, {
    useClass: GetRecentActivityQueryHandler,
  });
  container.register(TOKENS.CQRS.Queries.GetRequestLogs, {
    useClass: GetRequestLogsQueryHandler,
  });

  container.register(TOKENS.CQRS.Handlers.FeedInteraction, {
    useClass: FeedInteractionHandler,
  });
  container.register(TOKENS.CQRS.Handlers.MessageSent, {
    useClass: MessageSentHandler,
  });
  container.register(TOKENS.CQRS.Handlers.MessageStatusUpdatedEvent, {
    useClass: MessageStatusUpdatedEventHandler,
  });
  container.register(TOKENS.CQRS.Handlers.MessageAttachmentsDeleted, {
    useClass: MessageAttachmentsDeletedHandler,
  });
  container.register(TOKENS.CQRS.Handlers.NotificationRequested, {
    useClass: NotificationRequestedHandler,
  });

  logger.info("[di] CQRS registered");
}

export function initCQRS(): void {
  const commandBus = container.resolve<CommandBus>(TOKENS.CQRS.Commands.Bus);
  const queryBus = container.resolve<QueryBus>(TOKENS.CQRS.Queries.Bus);
  const eventBus = container.resolve<EventBus>(TOKENS.CQRS.Handlers.EventBus);

  commandBus.register(
    RegisterUserCommand,
    container.resolve<RegisterUserCommandHandler>(
      TOKENS.CQRS.Commands.RegisterUser,
    ),
  );
  commandBus.register(
    FollowUserCommand,
    container.resolve<FollowUserCommandHandler>(
      TOKENS.CQRS.Commands.FollowUser,
    ),
  );
  commandBus.register(
    DeleteUserCommand,
    container.resolve<DeleteUserCommandHandler>(
      TOKENS.CQRS.Commands.DeleteUser,
    ),
  );
  commandBus.register(
    UpdateAvatarCommand,
    container.resolve<UpdateAvatarCommandHandler>(
      TOKENS.CQRS.Commands.UpdateAvatar,
    ),
  );
  commandBus.register(
    UpdateCoverCommand,
    container.resolve<UpdateCoverCommandHandler>(
      TOKENS.CQRS.Commands.UpdateCover,
    ),
  );
  commandBus.register(
    LikeActionCommand,
    container.resolve<LikeActionCommandHandler>(
      TOKENS.CQRS.Commands.LikeAction,
    ),
  );
  commandBus.register(
    LikeActionByPublicIdCommand,
    container.resolve<LikeActionByPublicIdCommandHandler>(
      TOKENS.CQRS.Commands.LikeActionByPublicId,
    ),
  );
  commandBus.register(
    CreateCommentCommand,
    container.resolve<CreateCommentCommandHandler>(
      TOKENS.CQRS.Commands.CreateComment,
    ),
  );
  commandBus.register(
    DeleteCommentCommand,
    container.resolve<DeleteCommentCommandHandler>(
      TOKENS.CQRS.Commands.DeleteComment,
    ),
  );
  commandBus.register(
    LikeCommentCommand,
    container.resolve<LikeCommentCommandHandler>(
      TOKENS.CQRS.Commands.LikeComment,
    ),
  );
  commandBus.register(
    CreatePostCommand,
    container.resolve<CreatePostCommandHandler>(
      TOKENS.CQRS.Commands.CreatePost,
    ),
  );
  commandBus.register(
    DeletePostCommand,
    container.resolve<DeletePostCommandHandler>(
      TOKENS.CQRS.Commands.DeletePost,
    ),
  );
  commandBus.register(
    RepostPostCommand,
    container.resolve<RepostPostCommandHandler>(
      TOKENS.CQRS.Commands.RepostPost,
    ),
  );
  commandBus.register(
    UnrepostPostCommand,
    container.resolve<UnrepostPostCommandHandler>(
      TOKENS.CQRS.Commands.UnrepostPost,
    ),
  );
  commandBus.register(
    RecordPostViewCommand,
    container.resolve<RecordPostViewCommandHandler>(
      TOKENS.CQRS.Commands.RecordPostView,
    ),
  );
  commandBus.register(
    UpdateProfileCommand,
    container.resolve<UpdateProfileCommandHandler>(
      TOKENS.CQRS.Commands.UpdateProfile,
    ),
  );
  commandBus.register(
    ChangePasswordCommand,
    container.resolve<ChangePasswordCommandHandler>(
      TOKENS.CQRS.Commands.ChangePassword,
    ),
  );

  commandBus.register(
    RequestPasswordResetCommand,
    container.resolve<RequestPasswordResetHandler>(
      TOKENS.CQRS.Handlers.RequestPasswordReset,
    ),
  );

  commandBus.register(
    ResetPasswordCommand,
    container.resolve<ResetPasswordHandler>(TOKENS.CQRS.Handlers.ResetPassword),
  );
  commandBus.register(
    VerifyEmailCommand,
    container.resolve<VerifyEmailHandler>(TOKENS.CQRS.Handlers.VerifyEmail),
  );

  commandBus.register(
    BanUserCommand,
    container.resolve<BanUserCommandHandler>(TOKENS.CQRS.Commands.BanUser),
  );
  commandBus.register(
    UnbanUserCommand,
    container.resolve<UnbanUserCommandHandler>(TOKENS.CQRS.Commands.UnbanUser),
  );
  commandBus.register(
    PromoteToAdminCommand,
    container.resolve<PromoteToAdminCommandHandler>(
      TOKENS.CQRS.Commands.PromoteToAdmin,
    ),
  );
  commandBus.register(
    DemoteFromAdminCommand,
    container.resolve<DemoteFromAdminCommandHandler>(
      TOKENS.CQRS.Commands.DemoteFromAdmin,
    ),
  );
  commandBus.register(
    LogRequestCommand,
    container.resolve<LogRequestCommandHandler>(
      TOKENS.CQRS.Commands.LogRequest,
    ),
  );

  eventBus.subscribe(
    UserInteractedWithPostEvent,
    container.resolve<FeedInteractionHandler>(
      TOKENS.CQRS.Handlers.FeedInteraction,
    ),
  );
  eventBus.subscribe(
    PostUploadedEvent,
    container.resolve<PostUploadHandler>(TOKENS.CQRS.Handlers.PostUpload),
  );
  eventBus.subscribe(
    PostDeletedEvent,
    container.resolve<PostDeleteHandler>(TOKENS.CQRS.Handlers.PostDelete),
  );
  eventBus.subscribe(
    UserAvatarChangedEvent,
    container.resolve<UserAvatarChangedHandler>(
      TOKENS.CQRS.Handlers.UserAvatarChanged,
    ),
  );
  eventBus.subscribe(
    UserUsernameChangedEvent,
    container.resolve<UserUsernameChangedHandler>(
      TOKENS.CQRS.Handlers.UserUsernameChanged,
    ),
  );
  eventBus.subscribe(
    UserCoverChangedEvent,
    container.resolve<UserCoverChangedHandler>(
      TOKENS.CQRS.Handlers.UserCoverChanged,
    ),
  );
  eventBus.subscribe(
    UserDeletedEvent,
    container.resolve<UserDeletedHandler>(TOKENS.CQRS.Handlers.UserDeleted),
  );
  eventBus.subscribe(
    MessageSentEvent,
    container.resolve<MessageSentHandler>(TOKENS.CQRS.Handlers.MessageSent),
  );
  eventBus.subscribe(
    MessageStatusUpdatedEvent,
    container.resolve<MessageStatusUpdatedEventHandler>(
      TOKENS.CQRS.Handlers.MessageStatusUpdatedEvent,
    ),
  );
  eventBus.subscribe(
    MessageAttachmentsDeletedEvent,
    container.resolve<MessageAttachmentsDeletedHandler>(
      TOKENS.CQRS.Handlers.MessageAttachmentsDeleted,
    ),
  );
  eventBus.subscribe(
    NotificationRequestedEvent,
    container.resolve<NotificationRequestedHandler>(
      TOKENS.CQRS.Handlers.NotificationRequested,
    ),
  );

  queryBus.register(
    GetMeQuery,
    container.resolve<GetMeQueryHandler>(TOKENS.CQRS.Queries.GetMe),
  );
  queryBus.register(
    GetAccountInfoQuery,
    container.resolve<GetAccountInfoQueryHandler>(
      TOKENS.CQRS.Queries.GetAccountInfo,
    ),
  );
  queryBus.register(
    GetDashboardStatsQuery,
    container.resolve<GetDashboardStatsQueryHandler>(
      TOKENS.CQRS.Queries.GetDashboardStats,
    ),
  );
  queryBus.register(
    GetWhoToFollowQuery,
    container.resolve<GetWhoToFollowQueryHandler>(
      TOKENS.CQRS.Queries.GetWhoToFollow,
    ),
  );
  queryBus.register(
    GetHandleSuggestionsQuery,
    container.resolve<GetHandleSuggestionsQueryHandler>(
      TOKENS.CQRS.Queries.GetHandleSuggestions,
    ),
  );
  queryBus.register(
    GetTrendingTagsQuery,
    container.resolve<GetTrendingTagsQueryHandler>(
      TOKENS.CQRS.Queries.GetTrendingTags,
    ),
  );
  queryBus.register(
    GetPersonalizedFeedQuery,
    container.resolve<GetPersonalizedFeedQueryHandler>(
      TOKENS.CQRS.Queries.GetPersonalizedFeed,
    ),
  );
  queryBus.register(
    GetForYouFeedQuery,
    container.resolve<GetForYouFeedQueryHandler>(
      TOKENS.CQRS.Queries.GetForYouFeed,
    ),
  );
  queryBus.register(
    GetTrendingFeedQuery,
    container.resolve<GetTrendingFeedQueryHandler>(
      TOKENS.CQRS.Queries.GetTrendingFeed,
    ),
  );
  queryBus.register(
    GetPostByPublicIdQuery,
    container.resolve<GetPostByPublicIdQueryHandler>(
      TOKENS.CQRS.Queries.GetPostByPublicId,
    ),
  );
  queryBus.register(
    GetPostBySlugQuery,
    container.resolve<GetPostBySlugQueryHandler>(
      TOKENS.CQRS.Queries.GetPostBySlug,
    ),
  );
  queryBus.register(
    GetPostsQuery,
    container.resolve<GetPostsQueryHandler>(TOKENS.CQRS.Queries.GetPosts),
  );
  queryBus.register(
    GetPostsByUserQuery,
    container.resolve<GetPostsByUserQueryHandler>(
      TOKENS.CQRS.Queries.GetPostsByUser,
    ),
  );
  queryBus.register(
    SearchPostsByTagsQuery,
    container.resolve<SearchPostsByTagsQueryHandler>(
      TOKENS.CQRS.Queries.SearchPostsByTags,
    ),
  );
  queryBus.register(
    GetAllTagsQuery,
    container.resolve<GetAllTagsQueryHandler>(TOKENS.CQRS.Queries.GetAllTags),
  );
  queryBus.register(
    GetLikedPostsByUserQuery,
    container.resolve<GetLikedPostsByUserHandler>(
      TOKENS.CQRS.Queries.GetLikedPostsByUser,
    ),
  );
  queryBus.register(
    GetUserByPublicIdQuery,
    container.resolve<GetUserByPublicIdQueryHandler>(
      TOKENS.CQRS.Queries.GetUserByPublicId,
    ),
  );
  queryBus.register(
    GetUserByHandleQuery,
    container.resolve<GetUserByHandleQueryHandler>(
      TOKENS.CQRS.Queries.GetUserByHandle,
    ),
  );
  queryBus.register(
    GetUsersQuery,
    container.resolve<GetUsersQueryHandler>(TOKENS.CQRS.Queries.GetUsers),
  );
  queryBus.register(
    CheckFollowStatusQuery,
    container.resolve<CheckFollowStatusQueryHandler>(
      TOKENS.CQRS.Queries.CheckFollowStatus,
    ),
  );
  queryBus.register(
    GetFollowersQuery,
    container.resolve<GetFollowersQueryHandler>(
      TOKENS.CQRS.Queries.GetFollowers,
    ),
  );
  queryBus.register(
    GetFollowingQuery,
    container.resolve<GetFollowingQueryHandler>(
      TOKENS.CQRS.Queries.GetFollowing,
    ),
  );
  queryBus.register(
    GetAllPostsAdminQuery,
    container.resolve<GetAllPostsAdminQueryHandler>(
      TOKENS.CQRS.Queries.GetAllPostsAdmin,
    ),
  );
  queryBus.register(
    GetAllUsersAdminQuery,
    container.resolve<GetAllUsersAdminQueryHandler>(
      TOKENS.CQRS.Queries.GetAllUsersAdmin,
    ),
  );
  queryBus.register(
    GetAdminUserProfileQuery,
    container.resolve<GetAdminUserProfileQueryHandler>(
      TOKENS.CQRS.Queries.GetAdminUserProfile,
    ),
  );
  queryBus.register(
    GetUserStatsQuery,
    container.resolve<GetUserStatsQueryHandler>(
      TOKENS.CQRS.Queries.GetUserStats,
    ),
  );
  queryBus.register(
    GetRecentActivityQuery,
    container.resolve<GetRecentActivityQueryHandler>(
      TOKENS.CQRS.Queries.GetRecentActivity,
    ),
  );
  queryBus.register(
    GetRequestLogsQuery,
    container.resolve<GetRequestLogsQueryHandler>(
      TOKENS.CQRS.Queries.GetRequestLogs,
    ),
  );

  commandBus.register(
    CreateCommunityCommand,
    container.resolve<CreateCommunityCommandHandler>(
      TOKENS.CQRS.Commands.CreateCommunity,
    ),
  );
  commandBus.register(
    JoinCommunityCommand,
    container.resolve<JoinCommunityCommandHandler>(
      TOKENS.CQRS.Commands.JoinCommunity,
    ),
  );
  commandBus.register(
    LeaveCommunityCommand,
    container.resolve<LeaveCommunityCommandHandler>(
      TOKENS.CQRS.Commands.LeaveCommunity,
    ),
  );
  queryBus.register(
    GetCommunityDetailsQuery,
    container.resolve<GetCommunityDetailsQueryHandler>(
      TOKENS.CQRS.Queries.GetCommunityDetails,
    ),
  );
  queryBus.register(
    GetUserCommunitiesQuery,
    container.resolve<GetUserCommunitiesQueryHandler>(
      TOKENS.CQRS.Queries.GetUserCommunities,
    ),
  );
  queryBus.register(
    GetCommunityFeedQuery,
    container.resolve<GetCommunityFeedQueryHandler>(
      TOKENS.CQRS.Queries.GetCommunityFeed,
    ),
  );
  commandBus.register(
    UpdateCommunityCommand,
    container.resolve<UpdateCommunityCommandHandler>(
      TOKENS.CQRS.Commands.UpdateCommunity,
    ),
  );
  commandBus.register(
    DeleteCommunityCommand,
    container.resolve<DeleteCommunityCommandHandler>(
      TOKENS.CQRS.Commands.DeleteCommunity,
    ),
  );
  commandBus.register(
    KickMemberCommand,
    container.resolve<KickMemberCommandHandler>(
      TOKENS.CQRS.Commands.KickMember,
    ),
  );
  queryBus.register(
    GetAllCommunitiesQuery,
    container.resolve<GetAllCommunitiesQueryHandler>(
      TOKENS.CQRS.Queries.GetAllCommunities,
    ),
  );
  queryBus.register(
    GetCommunityMembersQuery,
    container.resolve<GetCommunityMembersQueryHandler>(
      TOKENS.CQRS.Queries.GetCommunityMembers,
    ),
  );

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
  container.register(TOKENS.CQRS.Handlers.Realtime, {
    useValue: realtimeHandlers,
  });

  logger.info("[di] CQRS initialized");
}
