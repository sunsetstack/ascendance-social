import { container } from "tsyringe";

import { CommandBus } from "@/application/common/buses/command.bus";
import { QueryBus } from "@/application/common/buses/query.bus";
import { EventBus } from "@/application/common/buses/event.bus";
import type { ICommand } from "@/application/common/interfaces/command.interface";
import type { ICommandHandler } from "@/application/common/interfaces/command-handler.interface";
import type { IEvent } from "@/application/common/interfaces/event.interface";
import type { IEventHandler } from "@/application/common/interfaces/event-handler.interface";
import type { IQuery } from "@/application/common/interfaces/query.interface";
import type { IQueryHandler } from "@/application/common/interfaces/query-handler.interface";
import { SetFollowStateCommand } from "@/application/commands/users/setFollowState/setFollowState.command";
import { SetFollowStateCommandHandler } from "@/application/commands/users/setFollowState/setFollowState.handler";
import { RegisterUserCommandHandler } from "@/application/commands/users/register/register.handler";
import { RegisterUserCommand } from "@/application/commands/users/register/register.command";
import { LoginCommand } from "@/application/commands/auth/login/login.command";
import { LoginCommandHandler } from "@/application/commands/auth/login/login.handler";
import { RefreshSessionCommand } from "@/application/commands/auth/refreshSession/refreshSession.command";
import { RefreshSessionCommandHandler } from "@/application/commands/auth/refreshSession/refreshSession.handler";
import { ClearCacheCommand } from "@/application/commands/admin/clearCache/clearCache.command";
import { ClearCacheCommandHandler } from "@/application/commands/admin/clearCache/clearCache.handler";
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
import { ImageAssetCleanupRequestedEvent } from "@/application/events/image/image.event";
import { LikeActionCommand } from "@/application/commands/users/likeAction/likeAction.command";
import { LikeActionCommandHandler } from "@/application/commands/users/likeAction/likeAction.handler";
import { LikeActionByPublicIdCommand } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.command";
import { LikeActionByPublicIdCommandHandler } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.handler";
import { PostUploadHandler } from "@/application/events/post/post-uploaded.handler";
import { PostDeleteHandler } from "@/application/events/post/post-deleted.handler";
import { ImageAssetCleanupRequestedHandler } from "@/application/events/image/image-asset-cleanup-requested.handler";
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
import { UpdateCommentCommand } from "@/application/commands/comments/updateComment/updateComment.command";
import { UpdateCommentCommandHandler } from "@/application/commands/comments/updateComment/update-comment.handler";
import { MessageSentHandler } from "@/application/events/message/message-sent.handler";
import { MessageStatusUpdatedHandler as MessageStatusUpdatedEventHandler } from "@/application/events/message/message-status-updated.handler";
import { MessageAttachmentsDeletedHandler } from "@/application/handlers/message/MessageAttachmentsDeletedHandler";
import {
  MessageSentEvent,
  MessageStatusUpdatedEvent,
  MessageAttachmentsDeletedEvent,
} from "@/application/events/message/message.event";
import { LogAuthActivityCommandHandler } from "@/application/commands/admin/logAuthActivity/logAuthActivity.handler";
import { LogSecurityAuditCommandHandler } from "@/application/commands/admin/logSecurityAudit/logSecurityAudit.handler";
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
import { GetNewFeedQuery } from "@/application/queries/feed/getNewFeed/getNewFeed.query";
import { GetNewFeedQueryHandler } from "@/application/queries/feed/getNewFeed/getNewFeed.handler";
import { GetCommentsByPostQuery } from "@/application/queries/comments/getCommentsByPost/getCommentsByPost.query";
import { GetCommentsByPostQueryHandler } from "@/application/queries/comments/getCommentsByPost/getCommentsByPost.handler";
import { GetCommentsByUserQuery } from "@/application/queries/comments/getCommentsByUser/getCommentsByUser.query";
import { GetCommentsByUserQueryHandler } from "@/application/queries/comments/getCommentsByUser/getCommentsByUser.handler";
import { GetCommentThreadQuery } from "@/application/queries/comments/getCommentThread/getCommentThread.query";
import { GetCommentThreadQueryHandler } from "@/application/queries/comments/getCommentThread/getCommentThread.handler";
import { GetCommentRepliesQuery } from "@/application/queries/comments/getCommentReplies/getCommentReplies.query";
import { GetCommentRepliesQueryHandler } from "@/application/queries/comments/getCommentReplies/getCommentReplies.handler";
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
import { SearchAllQuery } from "@/application/queries/search/searchAll/searchAll.query";
import { SearchAllQueryHandler } from "@/application/queries/search/searchAll/searchAll.handler";
import { AddFavoriteCommand } from "@/application/commands/favorite/addFavorite/addFavorite.command";
import { AddFavoriteCommandHandler } from "@/application/commands/favorite/addFavorite/addFavorite.handler";
import { RemoveFavoriteCommand } from "@/application/commands/favorite/removeFavorite/removeFavorite.command";
import { RemoveFavoriteCommandHandler } from "@/application/commands/favorite/removeFavorite/removeFavorite.handler";
import { RemoveFavoriteAdminCommand } from "@/application/commands/favorite/removeFavoriteAdmin/removeFavoriteAdmin.command";
import { RemoveFavoriteAdminCommandHandler } from "@/application/commands/favorite/removeFavoriteAdmin/removeFavoriteAdmin.handler";
import { CreateNotificationCommand } from "@/application/commands/notification/createNotification/createNotification.command";
import { CreateNotificationCommandHandler } from "@/application/commands/notification/createNotification/createNotification.handler";
import { MarkAsReadCommand } from "@/application/commands/notification/markAsRead/markAsRead.command";
import { MarkAsReadCommandHandler } from "@/application/commands/notification/markAsRead/markAsRead.handler";
import { MarkAllAsReadCommand } from "@/application/commands/notification/markAllAsRead/markAllAsRead.command";
import { MarkAllAsReadCommandHandler } from "@/application/commands/notification/markAllAsRead/markAllAsRead.handler";
import { SendMessageCommand } from "@/application/commands/messaging/sendMessage/sendMessage.command";
import { SendMessageCommandHandler } from "@/application/commands/messaging/sendMessage/sendMessage.handler";
import { EditMessageCommand } from "@/application/commands/messaging/editMessage/editMessage.command";
import { EditMessageCommandHandler } from "@/application/commands/messaging/editMessage/editMessage.handler";
import { DeleteMessageCommand } from "@/application/commands/messaging/deleteMessage/deleteMessage.command";
import { DeleteMessageCommandHandler } from "@/application/commands/messaging/deleteMessage/deleteMessage.handler";
import { InitiateConversationCommand } from "@/application/commands/messaging/initiateConversation/initiateConversation.command";
import { InitiateConversationCommandHandler } from "@/application/commands/messaging/initiateConversation/initiateConversation.handler";
import { MarkConversationReadCommand } from "@/application/commands/messaging/markConversationRead/markConversationRead.command";
import { MarkConversationReadCommandHandler } from "@/application/commands/messaging/markConversationRead/markConversationRead.handler";
import { ListConversationsQuery } from "@/application/queries/messaging/listConversations/listConversations.query";
import { ListConversationsQueryHandler } from "@/application/queries/messaging/listConversations/listConversations.handler";
import { GetConversationMessagesQuery } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.query";
import { GetConversationMessagesQueryHandler } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.handler";
import { GetNotificationsQuery } from "@/application/queries/notification/getNotifications/getNotifications.query";
import { GetNotificationsQueryHandler } from "@/application/queries/notification/getNotifications/getNotifications.handler";
import { GetUnreadCountQuery } from "@/application/queries/notification/getUnreadCount/getUnreadCount.query";
import { GetUnreadCountQueryHandler } from "@/application/queries/notification/getUnreadCount/getUnreadCount.handler";
import { GetFavoritesQuery } from "@/application/queries/favorite/getFavorites/getFavorites.query";
import { GetFavoritesQueryHandler } from "@/application/queries/favorite/getFavorites/getFavorites.handler";
import { GetAllTagsQuery } from "@/application/queries/tags/getAllTags/getAllTags.query";
import { GetAllTagsQueryHandler } from "@/application/queries/tags/getAllTags/getAllTags.handler";
import { GetLikedPostsByUserQuery } from "@/application/queries/post/getLikedPostsByUser/getLikedPostsByUser.query";
import { GetLikedPostsByUserHandler } from "@/application/queries/post/getLikedPostsByUser/getLikedPostsByUser.handler";
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
import { GetUserByHandleQuery } from "@/application/queries/users/getUserByHandle/getUserByHandle.query";
import { GetUserByHandleQueryHandler } from "@/application/queries/users/getUserByHandle/getUserByHandle.handler";
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
import { LogAuthActivityCommand } from "@/application/commands/admin/logAuthActivity/logAuthActivity.command";
import { LogSecurityAuditCommand } from "@/application/commands/admin/logSecurityAudit/logSecurityAudit.command";
import { GetRequestLogsQuery } from "@/application/queries/admin/getRequestLogs/getRequestLogs.query";
import { GetRequestLogsQueryHandler } from "@/application/queries/admin/getRequestLogs/getRequestLogs.handler";
import { GetAuthActivityLogsQuery } from "@/application/queries/admin/getAuthActivityLogs/getAuthActivityLogs.query";
import { GetAuthActivityLogsQueryHandler } from "@/application/queries/admin/getAuthActivityLogs/getAuthActivityLogs.handler";
import { logger } from "@/utils/winston";
import { TOKENS } from "@/types/tokens";

type Constructor<T = unknown> = new (...args: any[]) => T;
type HandlerToken = string;
type ContainerRegistration = readonly [HandlerToken, Constructor];
type CommandBusRegistration = readonly [Constructor<ICommand>, HandlerToken];
type QueryBusRegistration = readonly [Constructor<IQuery>, HandlerToken];
type EventSubscription = readonly [Constructor<IEvent>, HandlerToken];

const commandHandlerRegistrations: readonly ContainerRegistration[] = [
  [TOKENS.CQRS.Commands.RegisterUser, RegisterUserCommandHandler],
  [TOKENS.CQRS.Commands.Login, LoginCommandHandler],
  [TOKENS.CQRS.Commands.RefreshSession, RefreshSessionCommandHandler],
  [TOKENS.CQRS.Commands.SetFollowState, SetFollowStateCommandHandler],
  [TOKENS.CQRS.Commands.DeleteUser, DeleteUserCommandHandler],
  [TOKENS.CQRS.Commands.UpdateAvatar, UpdateAvatarCommandHandler],
  [TOKENS.CQRS.Commands.UpdateCover, UpdateCoverCommandHandler],
  [TOKENS.CQRS.Commands.UpdateProfile, UpdateProfileCommandHandler],
  [TOKENS.CQRS.Commands.ChangePassword, ChangePasswordCommandHandler],
  [TOKENS.CQRS.Commands.ClearCache, ClearCacheCommandHandler],
  [TOKENS.CQRS.Commands.LikeAction, LikeActionCommandHandler],
  [
    TOKENS.CQRS.Commands.LikeActionByPublicId,
    LikeActionByPublicIdCommandHandler,
  ],
  [TOKENS.CQRS.Commands.CreateComment, CreateCommentCommandHandler],
  [TOKENS.CQRS.Commands.UpdateComment, UpdateCommentCommandHandler],
  [TOKENS.CQRS.Commands.DeleteComment, DeleteCommentCommandHandler],
  [TOKENS.CQRS.Commands.LikeComment, LikeCommentCommandHandler],
  [TOKENS.CQRS.Commands.CreatePost, CreatePostCommandHandler],
  [TOKENS.CQRS.Commands.DeletePost, DeletePostCommandHandler],
  [TOKENS.CQRS.Commands.RepostPost, RepostPostCommandHandler],
  [TOKENS.CQRS.Commands.UnrepostPost, UnrepostPostCommandHandler],
  [TOKENS.CQRS.Commands.RecordPostView, RecordPostViewCommandHandler],
  [TOKENS.CQRS.Commands.AddFavorite, AddFavoriteCommandHandler],
  [TOKENS.CQRS.Commands.RemoveFavorite, RemoveFavoriteCommandHandler],
  [TOKENS.CQRS.Commands.RemoveFavoriteAdmin, RemoveFavoriteAdminCommandHandler],
  [TOKENS.CQRS.Commands.CreateNotification, CreateNotificationCommandHandler],
  [TOKENS.CQRS.Commands.MarkAsRead, MarkAsReadCommandHandler],
  [TOKENS.CQRS.Commands.MarkAllAsRead, MarkAllAsReadCommandHandler],
  [TOKENS.CQRS.Commands.SendMessage, SendMessageCommandHandler],
  [TOKENS.CQRS.Commands.EditMessage, EditMessageCommandHandler],
  [TOKENS.CQRS.Commands.DeleteMessage, DeleteMessageCommandHandler],
  [
    TOKENS.CQRS.Commands.InitiateConversation,
    InitiateConversationCommandHandler,
  ],
  [
    TOKENS.CQRS.Commands.MarkConversationRead,
    MarkConversationReadCommandHandler,
  ],
  [TOKENS.CQRS.Commands.BanUser, BanUserCommandHandler],
  [TOKENS.CQRS.Commands.UnbanUser, UnbanUserCommandHandler],
  [TOKENS.CQRS.Commands.PromoteToAdmin, PromoteToAdminCommandHandler],
  [TOKENS.CQRS.Commands.DemoteFromAdmin, DemoteFromAdminCommandHandler],
  [TOKENS.CQRS.Commands.LogRequest, LogRequestCommandHandler],
  [TOKENS.CQRS.Commands.LogAuthActivity, LogAuthActivityCommandHandler],
  [TOKENS.CQRS.Commands.LogSecurityAudit, LogSecurityAuditCommandHandler],
  [TOKENS.CQRS.Commands.CreateCommunity, CreateCommunityCommandHandler],
  [TOKENS.CQRS.Commands.JoinCommunity, JoinCommunityCommandHandler],
  [TOKENS.CQRS.Commands.LeaveCommunity, LeaveCommunityCommandHandler],
  [TOKENS.CQRS.Commands.UpdateCommunity, UpdateCommunityCommandHandler],
  [TOKENS.CQRS.Commands.DeleteCommunity, DeleteCommunityCommandHandler],
  [TOKENS.CQRS.Commands.KickMember, KickMemberCommandHandler],
  [TOKENS.CQRS.Handlers.RequestPasswordReset, RequestPasswordResetHandler],
  [TOKENS.CQRS.Handlers.ResetPassword, ResetPasswordHandler],
  [TOKENS.CQRS.Handlers.VerifyEmail, VerifyEmailHandler],
];

const queryHandlerRegistrations: readonly ContainerRegistration[] = [
  [TOKENS.CQRS.Queries.GetMe, GetMeQueryHandler],
  [TOKENS.CQRS.Queries.GetAccountInfo, GetAccountInfoQueryHandler],
  [TOKENS.CQRS.Queries.GetUserByPublicId, GetUserByPublicIdQueryHandler],
  [TOKENS.CQRS.Queries.GetUserByHandle, GetUserByHandleQueryHandler],
  [TOKENS.CQRS.Queries.GetUsers, GetUsersQueryHandler],
  [TOKENS.CQRS.Queries.CheckFollowStatus, CheckFollowStatusQueryHandler],
  [TOKENS.CQRS.Queries.GetFollowers, GetFollowersQueryHandler],
  [TOKENS.CQRS.Queries.GetFollowing, GetFollowingQueryHandler],
  [TOKENS.CQRS.Queries.GetDashboardStats, GetDashboardStatsQueryHandler],
  [TOKENS.CQRS.Queries.GetAllUsersAdmin, GetAllUsersAdminQueryHandler],
  [TOKENS.CQRS.Queries.GetAdminUserProfile, GetAdminUserProfileQueryHandler],
  [TOKENS.CQRS.Queries.GetUserStats, GetUserStatsQueryHandler],
  [TOKENS.CQRS.Queries.GetRecentActivity, GetRecentActivityQueryHandler],
  [TOKENS.CQRS.Queries.GetRequestLogs, GetRequestLogsQueryHandler],
  [TOKENS.CQRS.Queries.GetAuthActivityLogs, GetAuthActivityLogsQueryHandler],
  [TOKENS.CQRS.Queries.GetWhoToFollow, GetWhoToFollowQueryHandler],
  [TOKENS.CQRS.Queries.GetHandleSuggestions, GetHandleSuggestionsQueryHandler],
  [TOKENS.CQRS.Queries.GetTrendingTags, GetTrendingTagsQueryHandler],
  [TOKENS.CQRS.Queries.GetAllTags, GetAllTagsQueryHandler],
  [TOKENS.CQRS.Queries.GetPersonalizedFeed, GetPersonalizedFeedQueryHandler],
  [TOKENS.CQRS.Queries.GetNewFeed, GetNewFeedQueryHandler],
  [TOKENS.CQRS.Queries.GetForYouFeed, GetForYouFeedQueryHandler],
  [TOKENS.CQRS.Queries.GetTrendingFeed, GetTrendingFeedQueryHandler],
  [TOKENS.CQRS.Queries.GetCommentsByPost, GetCommentsByPostQueryHandler],
  [TOKENS.CQRS.Queries.GetCommentsByUser, GetCommentsByUserQueryHandler],
  [TOKENS.CQRS.Queries.GetCommentThread, GetCommentThreadQueryHandler],
  [TOKENS.CQRS.Queries.GetCommentReplies, GetCommentRepliesQueryHandler],
  [TOKENS.CQRS.Queries.GetPostByPublicId, GetPostByPublicIdQueryHandler],
  [TOKENS.CQRS.Queries.GetPostBySlug, GetPostBySlugQueryHandler],
  [TOKENS.CQRS.Queries.GetPosts, GetPostsQueryHandler],
  [TOKENS.CQRS.Queries.GetAllPostsAdmin, GetAllPostsAdminQueryHandler],
  [TOKENS.CQRS.Queries.GetPostsByUser, GetPostsByUserQueryHandler],
  [TOKENS.CQRS.Queries.GetLikedPostsByUser, GetLikedPostsByUserHandler],
  [TOKENS.CQRS.Queries.SearchPostsByTags, SearchPostsByTagsQueryHandler],
  [TOKENS.CQRS.Queries.SearchAll, SearchAllQueryHandler],
  [TOKENS.CQRS.Queries.GetFavorites, GetFavoritesQueryHandler],
  [TOKENS.CQRS.Queries.GetNotifications, GetNotificationsQueryHandler],
  [TOKENS.CQRS.Queries.GetUnreadCount, GetUnreadCountQueryHandler],
  [TOKENS.CQRS.Queries.ListConversations, ListConversationsQueryHandler],
  [
    TOKENS.CQRS.Queries.GetConversationMessages,
    GetConversationMessagesQueryHandler,
  ],
  [TOKENS.CQRS.Queries.GetCommunityDetails, GetCommunityDetailsQueryHandler],
  [TOKENS.CQRS.Queries.GetUserCommunities, GetUserCommunitiesQueryHandler],
  [TOKENS.CQRS.Queries.GetCommunityFeed, GetCommunityFeedQueryHandler],
  [TOKENS.CQRS.Queries.GetAllCommunities, GetAllCommunitiesQueryHandler],
  [TOKENS.CQRS.Queries.GetCommunityMembers, GetCommunityMembersQueryHandler],
];

const eventHandlerRegistrations: readonly ContainerRegistration[] = [
  [TOKENS.CQRS.Handlers.PostUpload, PostUploadHandler],
  [TOKENS.CQRS.Handlers.PostDelete, PostDeleteHandler],
  [
    TOKENS.CQRS.Handlers.ImageAssetCleanupRequested,
    ImageAssetCleanupRequestedHandler,
  ],
  [TOKENS.CQRS.Handlers.UserAvatarChanged, UserAvatarChangedHandler],
  [TOKENS.CQRS.Handlers.UserUsernameChanged, UserUsernameChangedHandler],
  [TOKENS.CQRS.Handlers.UserCoverChanged, UserCoverChangedHandler],
  [TOKENS.CQRS.Handlers.UserDeleted, UserDeletedHandler],
  [TOKENS.CQRS.Handlers.FeedInteraction, FeedInteractionHandler],
  [TOKENS.CQRS.Handlers.MessageSent, MessageSentHandler],
  [
    TOKENS.CQRS.Handlers.MessageStatusUpdatedEvent,
    MessageStatusUpdatedEventHandler,
  ],
  [
    TOKENS.CQRS.Handlers.MessageAttachmentsDeleted,
    MessageAttachmentsDeletedHandler,
  ],
  [TOKENS.CQRS.Handlers.NotificationRequested, NotificationRequestedHandler],
];

const commandBusRegistrations: readonly CommandBusRegistration[] = [
  [RegisterUserCommand, TOKENS.CQRS.Commands.RegisterUser],
  [LoginCommand, TOKENS.CQRS.Commands.Login],
  [RefreshSessionCommand, TOKENS.CQRS.Commands.RefreshSession],
  [SetFollowStateCommand, TOKENS.CQRS.Commands.SetFollowState],
  [DeleteUserCommand, TOKENS.CQRS.Commands.DeleteUser],
  [UpdateAvatarCommand, TOKENS.CQRS.Commands.UpdateAvatar],
  [UpdateCoverCommand, TOKENS.CQRS.Commands.UpdateCover],
  [UpdateProfileCommand, TOKENS.CQRS.Commands.UpdateProfile],
  [ChangePasswordCommand, TOKENS.CQRS.Commands.ChangePassword],
  [ClearCacheCommand, TOKENS.CQRS.Commands.ClearCache],
  [LikeActionCommand, TOKENS.CQRS.Commands.LikeAction],
  [LikeActionByPublicIdCommand, TOKENS.CQRS.Commands.LikeActionByPublicId],
  [CreateCommentCommand, TOKENS.CQRS.Commands.CreateComment],
  [UpdateCommentCommand, TOKENS.CQRS.Commands.UpdateComment],
  [DeleteCommentCommand, TOKENS.CQRS.Commands.DeleteComment],
  [LikeCommentCommand, TOKENS.CQRS.Commands.LikeComment],
  [CreatePostCommand, TOKENS.CQRS.Commands.CreatePost],
  [DeletePostCommand, TOKENS.CQRS.Commands.DeletePost],
  [RepostPostCommand, TOKENS.CQRS.Commands.RepostPost],
  [UnrepostPostCommand, TOKENS.CQRS.Commands.UnrepostPost],
  [RecordPostViewCommand, TOKENS.CQRS.Commands.RecordPostView],
  [AddFavoriteCommand, TOKENS.CQRS.Commands.AddFavorite],
  [RemoveFavoriteCommand, TOKENS.CQRS.Commands.RemoveFavorite],
  [RemoveFavoriteAdminCommand, TOKENS.CQRS.Commands.RemoveFavoriteAdmin],
  [CreateNotificationCommand, TOKENS.CQRS.Commands.CreateNotification],
  [MarkAsReadCommand, TOKENS.CQRS.Commands.MarkAsRead],
  [MarkAllAsReadCommand, TOKENS.CQRS.Commands.MarkAllAsRead],
  [SendMessageCommand, TOKENS.CQRS.Commands.SendMessage],
  [EditMessageCommand, TOKENS.CQRS.Commands.EditMessage],
  [DeleteMessageCommand, TOKENS.CQRS.Commands.DeleteMessage],
  [InitiateConversationCommand, TOKENS.CQRS.Commands.InitiateConversation],
  [MarkConversationReadCommand, TOKENS.CQRS.Commands.MarkConversationRead],
  [RequestPasswordResetCommand, TOKENS.CQRS.Handlers.RequestPasswordReset],
  [ResetPasswordCommand, TOKENS.CQRS.Handlers.ResetPassword],
  [VerifyEmailCommand, TOKENS.CQRS.Handlers.VerifyEmail],
  [BanUserCommand, TOKENS.CQRS.Commands.BanUser],
  [UnbanUserCommand, TOKENS.CQRS.Commands.UnbanUser],
  [PromoteToAdminCommand, TOKENS.CQRS.Commands.PromoteToAdmin],
  [DemoteFromAdminCommand, TOKENS.CQRS.Commands.DemoteFromAdmin],
  [LogRequestCommand, TOKENS.CQRS.Commands.LogRequest],
  [LogAuthActivityCommand, TOKENS.CQRS.Commands.LogAuthActivity],
  [LogSecurityAuditCommand, TOKENS.CQRS.Commands.LogSecurityAudit],
  [CreateCommunityCommand, TOKENS.CQRS.Commands.CreateCommunity],
  [JoinCommunityCommand, TOKENS.CQRS.Commands.JoinCommunity],
  [LeaveCommunityCommand, TOKENS.CQRS.Commands.LeaveCommunity],
  [UpdateCommunityCommand, TOKENS.CQRS.Commands.UpdateCommunity],
  [DeleteCommunityCommand, TOKENS.CQRS.Commands.DeleteCommunity],
  [KickMemberCommand, TOKENS.CQRS.Commands.KickMember],
];

const queryBusRegistrations: readonly QueryBusRegistration[] = [
  [GetMeQuery, TOKENS.CQRS.Queries.GetMe],
  [GetAccountInfoQuery, TOKENS.CQRS.Queries.GetAccountInfo],
  [GetUserByPublicIdQuery, TOKENS.CQRS.Queries.GetUserByPublicId],
  [GetUserByHandleQuery, TOKENS.CQRS.Queries.GetUserByHandle],
  [GetUsersQuery, TOKENS.CQRS.Queries.GetUsers],
  [CheckFollowStatusQuery, TOKENS.CQRS.Queries.CheckFollowStatus],
  [GetFollowersQuery, TOKENS.CQRS.Queries.GetFollowers],
  [GetFollowingQuery, TOKENS.CQRS.Queries.GetFollowing],
  [GetDashboardStatsQuery, TOKENS.CQRS.Queries.GetDashboardStats],
  [GetAllUsersAdminQuery, TOKENS.CQRS.Queries.GetAllUsersAdmin],
  [GetAdminUserProfileQuery, TOKENS.CQRS.Queries.GetAdminUserProfile],
  [GetUserStatsQuery, TOKENS.CQRS.Queries.GetUserStats],
  [GetRecentActivityQuery, TOKENS.CQRS.Queries.GetRecentActivity],
  [GetRequestLogsQuery, TOKENS.CQRS.Queries.GetRequestLogs],
  [GetAuthActivityLogsQuery, TOKENS.CQRS.Queries.GetAuthActivityLogs],
  [GetWhoToFollowQuery, TOKENS.CQRS.Queries.GetWhoToFollow],
  [GetHandleSuggestionsQuery, TOKENS.CQRS.Queries.GetHandleSuggestions],
  [GetTrendingTagsQuery, TOKENS.CQRS.Queries.GetTrendingTags],
  [GetAllTagsQuery, TOKENS.CQRS.Queries.GetAllTags],
  [GetPersonalizedFeedQuery, TOKENS.CQRS.Queries.GetPersonalizedFeed],
  [GetNewFeedQuery, TOKENS.CQRS.Queries.GetNewFeed],
  [GetForYouFeedQuery, TOKENS.CQRS.Queries.GetForYouFeed],
  [GetTrendingFeedQuery, TOKENS.CQRS.Queries.GetTrendingFeed],
  [GetCommentsByPostQuery, TOKENS.CQRS.Queries.GetCommentsByPost],
  [GetCommentsByUserQuery, TOKENS.CQRS.Queries.GetCommentsByUser],
  [GetCommentThreadQuery, TOKENS.CQRS.Queries.GetCommentThread],
  [GetCommentRepliesQuery, TOKENS.CQRS.Queries.GetCommentReplies],
  [GetPostByPublicIdQuery, TOKENS.CQRS.Queries.GetPostByPublicId],
  [GetPostBySlugQuery, TOKENS.CQRS.Queries.GetPostBySlug],
  [GetPostsQuery, TOKENS.CQRS.Queries.GetPosts],
  [GetAllPostsAdminQuery, TOKENS.CQRS.Queries.GetAllPostsAdmin],
  [GetPostsByUserQuery, TOKENS.CQRS.Queries.GetPostsByUser],
  [GetLikedPostsByUserQuery, TOKENS.CQRS.Queries.GetLikedPostsByUser],
  [SearchPostsByTagsQuery, TOKENS.CQRS.Queries.SearchPostsByTags],
  [SearchAllQuery, TOKENS.CQRS.Queries.SearchAll],
  [GetFavoritesQuery, TOKENS.CQRS.Queries.GetFavorites],
  [GetNotificationsQuery, TOKENS.CQRS.Queries.GetNotifications],
  [GetUnreadCountQuery, TOKENS.CQRS.Queries.GetUnreadCount],
  [ListConversationsQuery, TOKENS.CQRS.Queries.ListConversations],
  [GetConversationMessagesQuery, TOKENS.CQRS.Queries.GetConversationMessages],
  [GetCommunityDetailsQuery, TOKENS.CQRS.Queries.GetCommunityDetails],
  [GetUserCommunitiesQuery, TOKENS.CQRS.Queries.GetUserCommunities],
  [GetCommunityFeedQuery, TOKENS.CQRS.Queries.GetCommunityFeed],
  [GetAllCommunitiesQuery, TOKENS.CQRS.Queries.GetAllCommunities],
  [GetCommunityMembersQuery, TOKENS.CQRS.Queries.GetCommunityMembers],
];

const eventSubscriptions: readonly EventSubscription[] = [
  [UserInteractedWithPostEvent, TOKENS.CQRS.Handlers.FeedInteraction],
  [PostUploadedEvent, TOKENS.CQRS.Handlers.PostUpload],
  [PostDeletedEvent, TOKENS.CQRS.Handlers.PostDelete],
  [
    ImageAssetCleanupRequestedEvent,
    TOKENS.CQRS.Handlers.ImageAssetCleanupRequested,
  ],
  [UserAvatarChangedEvent, TOKENS.CQRS.Handlers.UserAvatarChanged],
  [UserUsernameChangedEvent, TOKENS.CQRS.Handlers.UserUsernameChanged],
  [UserCoverChangedEvent, TOKENS.CQRS.Handlers.UserCoverChanged],
  [UserDeletedEvent, TOKENS.CQRS.Handlers.UserDeleted],
  [MessageSentEvent, TOKENS.CQRS.Handlers.MessageSent],
  [MessageStatusUpdatedEvent, TOKENS.CQRS.Handlers.MessageStatusUpdatedEvent],
  [
    MessageAttachmentsDeletedEvent,
    TOKENS.CQRS.Handlers.MessageAttachmentsDeleted,
  ],
  [NotificationRequestedEvent, TOKENS.CQRS.Handlers.NotificationRequested],
];

function registerContainerHandlers(
  registrations: readonly ContainerRegistration[],
): void {
  for (const [token, handlerClass] of registrations) {
    container.register(token, { useClass: handlerClass });
  }
}

function registerCommandBusHandlers(
  commandBus: CommandBus,
  registrations: readonly CommandBusRegistration[],
): void {
  for (const [commandType, handlerToken] of registrations) {
    commandBus.register(
      commandType,
      container.resolve(handlerToken) as ICommandHandler<ICommand, unknown>,
    );
  }
}

function registerQueryBusHandlers(
  queryBus: QueryBus,
  registrations: readonly QueryBusRegistration[],
): void {
  for (const [queryType, handlerToken] of registrations) {
    queryBus.register(
      queryType,
      container.resolve(handlerToken) as IQueryHandler<IQuery, unknown>,
    );
  }
}

function subscribeEventHandlers(
  eventBus: EventBus,
  subscriptions: readonly EventSubscription[],
): void {
  for (const [eventType, handlerToken] of subscriptions) {
    eventBus.subscribe(
      eventType,
      container.resolve(handlerToken) as IEventHandler<IEvent>,
    );
  }
}

export function registerCQRS(): void {
  container.registerSingleton(TOKENS.CQRS.Commands.Bus, CommandBus);
  container.registerSingleton(TOKENS.CQRS.Queries.Bus, QueryBus);
  container.registerSingleton(TOKENS.CQRS.Handlers.EventBus, EventBus);

  registerContainerHandlers(commandHandlerRegistrations);
  registerContainerHandlers(queryHandlerRegistrations);
  registerContainerHandlers(eventHandlerRegistrations);

  logger.info("[di] CQRS registered");
}

export function initCQRS(): void {
  const commandBus = container.resolve<CommandBus>(TOKENS.CQRS.Commands.Bus);
  const queryBus = container.resolve<QueryBus>(TOKENS.CQRS.Queries.Bus);
  const eventBus = container.resolve<EventBus>(TOKENS.CQRS.Handlers.EventBus);

  registerCommandBusHandlers(commandBus, commandBusRegistrations);
  registerQueryBusHandlers(queryBus, queryBusRegistrations);
  subscribeEventHandlers(eventBus, eventSubscriptions);

  logger.info("[di] CQRS initialized");
}
