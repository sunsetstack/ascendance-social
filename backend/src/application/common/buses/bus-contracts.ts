import type { RegisterUserCommandHandler } from "@/application/commands/users/register/register.handler";
import type { LoginCommandHandler } from "@/application/commands/auth/login/login.handler";
import type { RefreshSessionCommandHandler } from "@/application/commands/auth/refreshSession/refreshSession.handler";
import type { SetFollowStateCommandHandler } from "@/application/commands/users/setFollowState/setFollowState.handler";
import type { DeleteUserCommandHandler } from "@/application/commands/users/deleteUser/deleteUser.handler";
import type { UpdateAvatarCommandHandler } from "@/application/commands/users/updateAvatar/updateAvatar.handler";
import type { UpdateCoverCommandHandler } from "@/application/commands/users/updateCover/updateCover.handler";
import type { UpdateProfileCommandHandler } from "@/application/commands/users/updateProfile/updateProfile.handler";
import type { ChangePasswordCommandHandler } from "@/application/commands/users/changePassword/changePassword.handler";
import type { ClearCacheCommandHandler } from "@/application/commands/admin/clearCache/clearCache.handler";
import type { UpdateInterestsCommandHandler } from "@/application/commands/feed/updateInterests/updateInterests.handler";
import type { LikeActionByPublicIdCommandHandler } from "@/application/commands/users/likeActionByPublicId/likeActionByPublicId.handler";
import type { CreateCommentCommandHandler } from "@/application/commands/comments/createComment/create-comment.handler";
import type { UpdateCommentCommandHandler } from "@/application/commands/comments/updateComment/update-comment.handler";
import type { DeleteCommentCommandHandler } from "@/application/commands/comments/deleteComment/delete-comment.handler";
import type { LikeCommentCommandHandler } from "@/application/commands/comments/likeComment/like-comment.handler";
import type { CreatePostCommandHandler } from "@/application/commands/post/createPost/createPost.handler";
import type { DeletePostCommandHandler } from "@/application/commands/post/deletePost/deletePost.handler";
import type { UpdatePostCommandHandler } from "@/application/commands/post/updatePost/updatePost.handler";
import type { RepostPostCommandHandler } from "@/application/commands/post/repostPost/repostPost.handler";
import type { UnrepostPostCommandHandler } from "@/application/commands/post/unrepostPost/unrepostPost.handler";
import type { RecordPostViewCommandHandler } from "@/application/commands/post/recordPostView/recordPostView.handler";
import type { AddFavoriteCommandHandler } from "@/application/commands/favorite/addFavorite/addFavorite.handler";
import type { RemoveFavoriteCommandHandler } from "@/application/commands/favorite/removeFavorite/removeFavorite.handler";
import type { RemoveFavoriteAdminCommandHandler } from "@/application/commands/favorite/removeFavoriteAdmin/removeFavoriteAdmin.handler";
import type { CreateNotificationCommandHandler } from "@/application/commands/notification/createNotification/createNotification.handler";
import type { MarkAsReadCommandHandler } from "@/application/commands/notification/markAsRead/markAsRead.handler";
import type { MarkAllAsReadCommandHandler } from "@/application/commands/notification/markAllAsRead/markAllAsRead.handler";
import type { SendMessageCommandHandler } from "@/application/commands/messaging/sendMessage/sendMessage.handler";
import type { ManageConversationCommandHandler } from "@/application/commands/messaging/manageConversation/manageConversation.handler";
import type { EditMessageCommandHandler } from "@/application/commands/messaging/editMessage/editMessage.handler";
import type { DeleteMessageCommandHandler } from "@/application/commands/messaging/deleteMessage/deleteMessage.handler";
import type { InitiateConversationCommandHandler } from "@/application/commands/messaging/initiateConversation/initiateConversation.handler";
import type { MarkConversationReadCommandHandler } from "@/application/commands/messaging/markConversationRead/markConversationRead.handler";
import type { RequestPasswordResetHandler } from "@/application/commands/users/requestPasswordReset/RequestPasswordResetHandler";
import type { ResetPasswordHandler } from "@/application/commands/users/resetPassword/ResetPasswordHandler";
import type { VerifyEmailHandler } from "@/application/commands/users/verifyEmail/VerifyEmailHandler";
import type { BanUserCommandHandler } from "@/application/commands/admin/banUser/banUser.handler";
import type { UnbanUserCommandHandler } from "@/application/commands/admin/unbanUser/unbanUser.handler";
import type { PromoteToAdminCommandHandler } from "@/application/commands/admin/promoteToAdmin/promoteToAdmin.handler";
import type { DemoteFromAdminCommandHandler } from "@/application/commands/admin/demoteFromAdmin/demoteFromAdmin.handler";
import type { LogRequestCommandHandler } from "@/application/commands/admin/logRequest/logRequest.handler";
import type { LogAuthActivityCommandHandler } from "@/application/commands/admin/logAuthActivity/logAuthActivity.handler";
import type { LogSecurityAuditCommandHandler } from "@/application/commands/admin/logSecurityAudit/logSecurityAudit.handler";
import type { UpdateUserActivityCommandHandler } from "@/application/commands/admin/updateUserActivity/updateUserActivity.handler";
import type { CreateCommunityCommandHandler } from "@/application/commands/community/createCommunity/createCommunity.handler";
import type { JoinCommunityCommandHandler } from "@/application/commands/community/joinCommunity/joinCommunity.handler";
import type { LeaveCommunityCommandHandler } from "@/application/commands/community/leaveCommunity/leaveCommunity.handler";
import type { UpdateCommunityCommandHandler } from "@/application/commands/community/updateCommunity/updateCommunity.handler";
import type { DeleteCommunityCommandHandler } from "@/application/commands/community/deleteCommunity/deleteCommunity.handler";
import type { KickMemberCommandHandler } from "@/application/commands/community/kickMember/kickMember.handler";
import type { GetMeQueryHandler } from "@/application/queries/users/getMe/getMe.handler";
import type { GetAccountInfoQueryHandler } from "@/application/queries/users/getAccountInfo/getAccountInfo.handler";
import type { GetUserByPublicIdQueryHandler } from "@/application/queries/users/getUserByPublicId/getUserByPublicId.handler";
import type { GetUserByHandleQueryHandler } from "@/application/queries/users/getUserByHandle/getUserByHandle.handler";
import type { GetUsersQueryHandler } from "@/application/queries/users/getUsers/getUsers.handler";
import type { CheckFollowStatusQueryHandler } from "@/application/queries/users/checkFollowStatus/checkFollowStatus.handler";
import type { GetFollowersQueryHandler } from "@/application/queries/users/getFollowers/getFollowers.handler";
import type { GetFollowingQueryHandler } from "@/application/queries/users/getFollowing/getFollowing.handler";
import type { GetDashboardStatsQueryHandler } from "@/application/queries/admin/getDashboardStats/getDashboardStats.handler";
import type { GetAllUsersAdminQueryHandler } from "@/application/queries/admin/getAllUsersAdmin/getAllUsersAdmin.handler";
import type { GetAdminUserProfileQueryHandler } from "@/application/queries/admin/getAdminUserProfile/getAdminUserProfile.handler";
import type { GetUserStatsQueryHandler } from "@/application/queries/admin/getUserStats/getUserStats.handler";
import type { GetRecentActivityQueryHandler } from "@/application/queries/admin/getRecentActivity/getRecentActivity.handler";
import type { GetRequestLogsQueryHandler } from "@/application/queries/admin/getRequestLogs/getRequestLogs.handler";
import type { GetAuthActivityLogsQueryHandler } from "@/application/queries/admin/getAuthActivityLogs/getAuthActivityLogs.handler";
import type { GetWhoToFollowQueryHandler } from "@/application/queries/users/getWhoToFollow/getWhoToFollow.handler";
import type { GetHandleSuggestionsQueryHandler } from "@/application/queries/users/getHandleSuggestions/getHandleSuggestions.handler";
import type { GetTrendingTagsQueryHandler } from "@/application/queries/tags/getTrendingTags/getTrendingTags.handler";
import type { GetAllTagsQueryHandler } from "@/application/queries/tags/getAllTags/getAllTags.handler";
import type { GetPersonalizedFeedQueryHandler } from "@/application/queries/feed/getPersonalizedFeed/getPersonalizedFeed.handler";
import type { GetNewFeedQueryHandler } from "@/application/queries/feed/getNewFeed/getNewFeed.handler";
import type { GetForYouFeedQueryHandler } from "@/application/queries/feed/getForYouFeed/getForYouFeed.handler";
import type { GetFollowingFeedQueryHandler } from "@/application/queries/feed/getFollowingFeed/getFollowingFeed.handler";
import type { GetFeedPreviewQueryHandler } from "@/application/queries/feed/getFeedPreview/getFeedPreview.handler";
import type { GetInterestsQueryHandler } from "@/application/queries/feed/interests/interests.handler";
import type { GetInterestFeedQueryHandler } from "@/application/queries/feed/interests/interests.handler";
import type { GetTrendingFeedQueryHandler } from "@/application/queries/feed/getTrendingFeed/getTrendingFeed.handler";
import type { GetCommentsByPostQueryHandler } from "@/application/queries/comments/getCommentsByPost/getCommentsByPost.handler";
import type { GetCommentsByUserQueryHandler } from "@/application/queries/comments/getCommentsByUser/getCommentsByUser.handler";
import type { GetCommentThreadQueryHandler } from "@/application/queries/comments/getCommentThread/getCommentThread.handler";
import type { GetCommentRepliesQueryHandler } from "@/application/queries/comments/getCommentReplies/getCommentReplies.handler";
import type { GetPostByPublicIdQueryHandler } from "@/application/queries/post/getPostByPublicId/getPostByPublicId.handler";
import type { GetPostBySlugQueryHandler } from "@/application/queries/post/getPostBySlug/getPostBySlug.handler";
import type { GetPostsQueryHandler } from "@/application/queries/post/getPosts/getPosts.handler";
import type { GetAllPostsAdminQueryHandler } from "@/application/queries/post/getAllPostsAdmin/getAllPostsAdmin.handler";
import type { GetPostsByUserQueryHandler } from "@/application/queries/post/getPostsByUser/getPostsByUser.handler";
import type { GetLikedPostsByUserHandler } from "@/application/queries/post/getLikedPostsByUser/getLikedPostsByUser.handler";
import type { SearchPostsByTagsQueryHandler } from "@/application/queries/post/searchPostsByTags/searchPostsByTags.handler";
import type { SearchAllQueryHandler } from "@/application/queries/search/searchAll/searchAll.handler";
import type { GetFavoritesQueryHandler } from "@/application/queries/favorite/getFavorites/getFavorites.handler";
import type { GetNotificationsQueryHandler } from "@/application/queries/notification/getNotifications/getNotifications.handler";
import type { GetUnreadCountQueryHandler } from "@/application/queries/notification/getUnreadCount/getUnreadCount.handler";
import type { ListConversationsQueryHandler } from "@/application/queries/messaging/listConversations/listConversations.handler";
import type { GetConversationMessagesQueryHandler } from "@/application/queries/messaging/getConversationMessages/getConversationMessages.handler";
import type { GetCommunityDetailsQueryHandler } from "@/application/queries/community/getCommunityDetails/getCommunityDetails.handler";
import type { GetUserCommunitiesQueryHandler } from "@/application/queries/community/getUserCommunities/getUserCommunities.handler";
import type { GetCommunityFeedQueryHandler } from "@/application/queries/community/getCommunityFeed/getCommunityFeed.handler";
import type { GetAllCommunitiesQueryHandler } from "@/application/queries/community/getAllCommunities/getAllCommunities.handler";
import type { GetCommunityMembersQueryHandler } from "@/application/queries/community/getCommunityMembers/getCommunityMembers.handler";

export interface BusRequest {
  readonly type: string;
}

export interface BusHandler {
  execute(request: BusRequest): Promise<unknown>;
}

export type BusRequestClass<TRequest extends BusRequest> = {
  new (...args: any[]): TRequest;
  readonly type?: TRequest["type"];
};

export type HandledRequest<THandlers extends BusHandler> =
  Parameters<THandlers["execute"]>[0];

export type BusContracts<THandlers extends BusHandler> = {
  [THandler in THandlers as HandledRequest<THandler>["type"]]: {
    request: HandledRequest<THandler>;
    result: Awaited<ReturnType<THandler["execute"]>>;
  };
};

export type HandledResult<
  THandlers extends BusHandler,
  TRequest extends HandledRequest<THandlers>,
> = BusContracts<THandlers>[TRequest["type"] & keyof BusContracts<THandlers>] extends {
  result: infer TResult;
}
  ? TResult
  : never;

type ContractBinding<TContract> = TContract extends {
  request: infer TRequest extends BusRequest;
  result: infer TResult;
}
  ? readonly [
      BusRequestClass<TRequest>,
      { execute: (request: TRequest) => Promise<TResult> },
    ]
  : never;

export type HandlerBinding<THandlers extends BusHandler> = ContractBinding<
  BusContracts<THandlers>[keyof BusContracts<THandlers>]
>;

type ContractDefinition<TBinding> = TBinding extends readonly [
  infer TRequestClass,
  infer THandler,
]
  ? readonly [TRequestClass, string, new (...args: any[]) => THandler]
  : never;

export type HandlerDefinition<THandlers extends BusHandler> = ContractDefinition<
  HandlerBinding<THandlers>
>;

export type CommandHandlers =
  | RegisterUserCommandHandler
  | LoginCommandHandler
  | RefreshSessionCommandHandler
  | SetFollowStateCommandHandler
  | DeleteUserCommandHandler
  | UpdateAvatarCommandHandler
  | UpdateCoverCommandHandler
  | UpdateProfileCommandHandler
  | ChangePasswordCommandHandler
  | ClearCacheCommandHandler
  | UpdateInterestsCommandHandler
  | LikeActionByPublicIdCommandHandler
  | CreateCommentCommandHandler
  | UpdateCommentCommandHandler
  | DeleteCommentCommandHandler
  | LikeCommentCommandHandler
  | CreatePostCommandHandler
  | DeletePostCommandHandler
  | UpdatePostCommandHandler
  | RepostPostCommandHandler
  | UnrepostPostCommandHandler
  | RecordPostViewCommandHandler
  | AddFavoriteCommandHandler
  | RemoveFavoriteCommandHandler
  | RemoveFavoriteAdminCommandHandler
  | CreateNotificationCommandHandler
  | MarkAsReadCommandHandler
  | MarkAllAsReadCommandHandler
  | SendMessageCommandHandler
  | ManageConversationCommandHandler
  | EditMessageCommandHandler
  | DeleteMessageCommandHandler
  | InitiateConversationCommandHandler
  | MarkConversationReadCommandHandler
  | RequestPasswordResetHandler
  | ResetPasswordHandler
  | VerifyEmailHandler
  | BanUserCommandHandler
  | UnbanUserCommandHandler
  | PromoteToAdminCommandHandler
  | DemoteFromAdminCommandHandler
  | LogRequestCommandHandler
  | LogAuthActivityCommandHandler
  | LogSecurityAuditCommandHandler
  | UpdateUserActivityCommandHandler
  | CreateCommunityCommandHandler
  | JoinCommunityCommandHandler
  | LeaveCommunityCommandHandler
  | UpdateCommunityCommandHandler
  | DeleteCommunityCommandHandler
  | KickMemberCommandHandler;

export type QueryHandlers =
  | GetMeQueryHandler
  | GetAccountInfoQueryHandler
  | GetUserByPublicIdQueryHandler
  | GetUserByHandleQueryHandler
  | GetUsersQueryHandler
  | CheckFollowStatusQueryHandler
  | GetFollowersQueryHandler
  | GetFollowingQueryHandler
  | GetDashboardStatsQueryHandler
  | GetAllUsersAdminQueryHandler
  | GetAdminUserProfileQueryHandler
  | GetUserStatsQueryHandler
  | GetRecentActivityQueryHandler
  | GetRequestLogsQueryHandler
  | GetAuthActivityLogsQueryHandler
  | GetWhoToFollowQueryHandler
  | GetHandleSuggestionsQueryHandler
  | GetTrendingTagsQueryHandler
  | GetAllTagsQueryHandler
  | GetPersonalizedFeedQueryHandler
  | GetNewFeedQueryHandler
  | GetForYouFeedQueryHandler
  | GetFollowingFeedQueryHandler
  | GetFeedPreviewQueryHandler
  | GetInterestsQueryHandler
  | GetInterestFeedQueryHandler
  | GetTrendingFeedQueryHandler
  | GetCommentsByPostQueryHandler
  | GetCommentsByUserQueryHandler
  | GetCommentThreadQueryHandler
  | GetCommentRepliesQueryHandler
  | GetPostByPublicIdQueryHandler
  | GetPostBySlugQueryHandler
  | GetPostsQueryHandler
  | GetAllPostsAdminQueryHandler
  | GetPostsByUserQueryHandler
  | GetLikedPostsByUserHandler
  | SearchPostsByTagsQueryHandler
  | SearchAllQueryHandler
  | GetFavoritesQueryHandler
  | GetNotificationsQueryHandler
  | GetUnreadCountQueryHandler
  | ListConversationsQueryHandler
  | GetConversationMessagesQueryHandler
  | GetCommunityDetailsQueryHandler
  | GetUserCommunitiesQueryHandler
  | GetCommunityFeedQueryHandler
  | GetAllCommunitiesQueryHandler
  | GetCommunityMembersQueryHandler;
