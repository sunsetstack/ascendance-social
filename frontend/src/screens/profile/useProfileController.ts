import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "react-toastify";
import { useQueryClient } from "@tanstack/react-query";
import { useGetUser, useUpdateUserAvatar, useUpdateUserCover, useUserComments, useUserLikedPosts, useUserPosts } from "../../hooks/user/useUsers";
import { useBanUser, useDeleteUserAdmin } from "../../hooks/admin/useAdmin";
import { useFollowUser, useIsFollowing } from "../../hooks/user/useUserAction";
import { useAuth } from "../../hooks/context/useAuth";
import { useInitiateConversation } from "../../hooks/messaging/useInitiateConversation";
import { buildProfileMetadata } from "../../lib/seo";
import { devError } from "@/lib/devLogger";

const BASE_URL = "/api";

const resolveProfileAssetUrl = (urlPath: string | undefined): string | undefined => {
	if (!urlPath) {
		return undefined;
	}

	return urlPath.startsWith("http")
		? urlPath
		: urlPath.startsWith("/")
			? `${BASE_URL}${urlPath}`
			: `${BASE_URL}/${urlPath}`;
};

export const useProfileController = () => {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const { user, isLoggedIn } = useAuth();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState(0);
	const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
	const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
	const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

	const profileUserId = id || user?.handle || user?.publicId;
	const { data: profileData, isLoading: isLoadingProfile, error: getUserError } = useGetUser(
		id ? id : isLoggedIn ? user?.handle : undefined,
	);

	const {
		data: imagesData,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading: isLoadingImages,
	} = useUserPosts(profileData?.publicId || "", {
		enabled: !!profileData?.publicId && (activeTab === 0 || activeTab === 2),
	});

	const {
		data: likedPostsData,
		fetchNextPage: fetchNextLikedPage,
		hasNextPage: hasNextLikedPage,
		isFetchingNextPage: isFetchingNextLikedPage,
		isLoading: isLoadingLikedPosts,
	} = useUserLikedPosts(profileData?.publicId || "", {
		enabled: !!profileData?.publicId && activeTab === 3,
	});

	const {
		data: commentsData,
		fetchNextPage: fetchNextCommentsPage,
		hasNextPage: hasNextCommentsPage,
		isFetchingNextPage: isFetchingNextCommentsPage,
		isLoading: isLoadingComments,
	} = useUserComments(profileData?.publicId || "", {
		enabled: !!profileData?.publicId && activeTab === 1,
	});

	const { data: isFollowing, isLoading: isCheckingFollow } = useIsFollowing(profileData?.publicId || "", {
		enabled: isLoggedIn && !!profileData?.publicId && profileData?.publicId !== user?.publicId,
	});

	const avatarMutation = useUpdateUserAvatar();
	const coverMutation = useUpdateUserCover();
	const { mutate: followUserMutation, isPending: followPending } = useFollowUser();
	const banUserMutation = useBanUser();
	const deleteUserMutation = useDeleteUserAdmin();
	const initiateConversationMutation = useInitiateConversation();

	const notifySuccess = useCallback((message: string) => toast.success(message), []);
	const notifyError = useCallback((message: string) => toast.error(message), []);

	const flattenedImages = useMemo(() => imagesData?.pages?.flatMap((page) => page.data) || [], [imagesData]);
	const flattenedLikedPosts = useMemo(() => likedPostsData?.pages?.flatMap((page) => page.data) || [], [likedPostsData]);
	const flattenedComments = useMemo(() => commentsData?.pages?.flatMap((page) => page.comments) || [], [commentsData]);
	const seoMetadata = useMemo(
		() =>
			buildProfileMetadata({
				id,
				handle: profileData?.handle,
				username: profileData?.username,
				bio: profileData?.bio,
			}),
		[id, profileData?.bio, profileData?.handle, profileData?.username],
	);

	const isProfileOwner = isLoggedIn && profileData?.publicId === user?.publicId;
	const isLoadingAllPosts = isLoadingImages || imagesData?.pages.length === 0;
	const isLoadingAllLiked = isLoadingLikedPosts || likedPostsData?.pages.length === 0;
	const isLoadingAllComments = isLoadingComments || commentsData?.pages.length === 0;
	const fullAvatarUrl = resolveProfileAssetUrl(profileData?.avatar);
	const fullCoverUrl = resolveProfileAssetUrl(profileData?.cover);

	const handleBanUser = useCallback(() => {
		if (!profileData?.publicId) {
			return;
		}

		const reason = window.prompt("Enter ban reason:");
		if (!reason) {
			return;
		}

		banUserMutation.mutate(
			{ publicId: profileData.publicId, reason },
			{
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: ["user", profileData.publicId] });
					queryClient.invalidateQueries({ queryKey: ["admin", "user", profileData.publicId] });
				},
			},
		);
	}, [banUserMutation, profileData?.publicId, queryClient]);

	const handleDeleteUser = useCallback(() => {
		if (!profileData?.publicId) {
			return;
		}

		if (window.confirm("Are you sure you want to PERMANENTLY delete this user? This cannot be undone.")) {
			deleteUserMutation.mutate(profileData.publicId, {
				onSuccess: () => {
					navigate("/admin");
				},
			});
		}
	}, [deleteUserMutation, navigate, profileData?.publicId]);

	const handleFollowUser = useCallback(() => {
		if (!isLoggedIn) {
			navigate("/login");
			return;
		}

		if (!profileUserId || !profileData) {
			return;
		}

		followUserMutation(profileData.publicId, {
			onSuccess: () => {
				queryClient.invalidateQueries({ queryKey: ["isFollowing", profileData.publicId] });
				queryClient.invalidateQueries({ queryKey: ["user", profileData.publicId] });
			},
			onError: (error: Error) => {
				notifyError(`Action failed: ${error?.message || "Unknown error"}`);
				devError("Error following/unfollowing user:", error);
			},
		});
	}, [followUserMutation, isLoggedIn, navigate, notifyError, profileData, profileUserId, queryClient]);

	const handleMessageUser = useCallback(() => {
		if (!isLoggedIn) {
			navigate("/login");
			return;
		}

		if (!profileData?.publicId || profileData.publicId === user?.publicId) {
			return;
		}

		initiateConversationMutation.mutate(profileData.publicId, {
			onSuccess: (response) => {
				navigate(`/messages?conversation=${response.conversation.publicId}`);
			},
			onError: (error: Error) => {
				notifyError(`Unable to start chat: ${error?.message || "Unknown error"}`);
			},
		});
	}, [initiateConversationMutation, isLoggedIn, navigate, notifyError, profileData?.publicId, user?.publicId]);

	const handleAvatarUpload = useCallback(
		(croppedImage: Blob | null) => {
			if (!croppedImage) {
				notifyError("Image processing failed.");
				setIsAvatarModalOpen(false);
				return;
			}

			try {
				avatarMutation.mutate(croppedImage, {
					onSuccess: () => notifySuccess("Avatar updated successfully!"),
					onError: (error: Error) => notifyError(`Avatar upload failed: ${error?.message || "Error"}`),
					onSettled: () => setIsAvatarModalOpen(false),
				});
			} catch (error) {
				notifyError("Error processing image");
				devError("Error converting dataURL to Blob:", error);
			}
		},
		[avatarMutation, notifyError, notifySuccess],
	);

	const handleCoverUpload = useCallback(
		(croppedImage: Blob | null) => {
			if (!croppedImage) {
				notifyError("Image processing failed.");
				setIsCoverModalOpen(false);
				return;
			}

			try {
				coverMutation.mutate(croppedImage, {
					onSuccess: () => notifySuccess("Cover photo updated successfully!"),
					onError: (error: Error) => notifyError(`Cover upload failed: ${error?.message || "Error"}`),
					onSettled: () => setIsCoverModalOpen(false),
				});
			} catch (error) {
				notifyError("Error processing image");
				devError("Error converting dataURL to Blob:", error);
			}
		},
		[coverMutation, notifyError, notifySuccess],
	);

	return {
		seoMetadata,
		profileData,
		isLoadingProfile,
		getUserError,
		isLoggedIn,
		user,
		activeTab,
		setActiveTab,
		flattenedImages,
		flattenedLikedPosts,
		flattenedComments,
		isLoadingImages,
		isLoadingComments,
		isLoadingAllPosts,
		isLoadingAllLiked,
		isLoadingAllComments,
		hasNextPage: !!hasNextPage,
		hasNextLikedPage: !!hasNextLikedPage,
		hasNextCommentsPage: !!hasNextCommentsPage,
		isFetchingNextPage,
		isFetchingNextLikedPage,
		isFetchingNextCommentsPage,
		fetchNextPage,
		fetchNextLikedPage,
		fetchNextCommentsPage,
		isFollowing,
		isCheckingFollow,
		followPending,
		isProfileOwner,
		fullAvatarUrl,
		fullCoverUrl,
		isAvatarModalOpen,
		isCoverModalOpen,
		isEditProfileOpen,
		setIsAvatarModalOpen,
		setIsCoverModalOpen,
		setIsEditProfileOpen,
		handleBanUser,
		handleDeleteUser,
		handleFollowUser,
		handleMessageUser,
		handleAvatarUpload,
		handleCoverUpload,
		notifySuccess,
		notifyError,
		navigateBack: () => navigate(-1),
		navigateHome: () => navigate("/"),
		navigateToAdminDetails: () => {
			if (profileData?.publicId) {
				navigate(`/admin/users/${profileData.publicId}`);
			}
		},
	};
};
