import React, { useState, useCallback } from "react";
import {
	Box,
	Button,
	Typography,
	Avatar,
	Modal,
	Paper,
	CircularProgress,
	useTheme,
	IconButton,
	alpha,
	Tabs,
	Tab,
	Tooltip,
} from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import GavelIcon from "@mui/icons-material/Gavel";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";

import { useNavigate, useParams } from "react-router-dom";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import Gallery from "../components/Gallery";
import { EditProfile } from "../components/EditProfile";
import {
	useGetUser,
	useUpdateUserAvatar,
	useUpdateUserCover,
	useUserPosts,
	useUserLikedPosts,
	useUserComments,
} from "../hooks/user/useUsers";
import { useBanUser, useDeleteUserAdmin } from "../hooks/admin/useAdmin";
import { useFollowUser, useIsFollowing } from "../hooks/user/useUserAction";
import { useAuth } from "../hooks/context/useAuth";
import ImageEditor from "../components/ImageEditor";
import { useQueryClient } from "@tanstack/react-query";
import { useInitiateConversation } from "../hooks/messaging/useInitiateConversation";
import { useTranslation } from "react-i18next";
import { PageSeo, buildProfileMetadata } from "../lib/seo";
import { devError } from "@/lib/devLogger";

const BASE_URL = "/api";

const Profile: React.FC = () => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const { user, isLoggedIn } = useAuth();
	const theme = useTheme();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState(0);

	const profileUserId = id || user?.handle || user?.publicId;

	// Data for profile being viewed - use the identifier to get user data
	// If no id is provided in URL and user is logged in, use their data
	const {
		data: profileData,
		isLoading: isLoadingProfile,
		error: getUserError,
	} = useGetUser(id ? id : isLoggedIn ? user?.handle : undefined);

	const {
		data: imagesData,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading: isLoadingImages,
	} = useUserPosts(profileData?.publicId || "", { enabled: !!profileData?.publicId && activeTab === 0 });

	const {
		data: likedPostsData,
		fetchNextPage: fetchNextLikedPage,
		hasNextPage: hasNextLikedPage,
		isFetchingNextPage: isFetchingNextLikedPage,
		isLoading: isLoadingLikedPosts,
	} = useUserLikedPosts(profileData?.publicId || "", { enabled: !!profileData?.publicId && activeTab === 3 });

	const {
		data: commentsData,
		fetchNextPage: fetchNextCommentsPage,
		hasNextPage: hasNextCommentsPage,
		isFetchingNextPage: isFetchingNextCommentsPage,
		isLoading: isLoadingComments,
	} = useUserComments(profileData?.publicId || "", { enabled: !!profileData?.publicId && activeTab === 1 });

	const { data: isFollowing, isLoading: isCheckingFollow } = useIsFollowing(profileData?.publicId || "", {
		enabled: isLoggedIn && !!profileData?.publicId && profileData?.publicId !== user?.publicId,
	});

	// modals state
	const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false);
	const [isCoverModalOpen, setIsCoverModalOpen] = useState(false);
	const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

	//check if user is the owner of the profile
	const isProfileOwner = isLoggedIn && profileData?.publicId === user?.publicId;

	// mutations
	const avatarMutation = useUpdateUserAvatar();
	const coverMutation = useUpdateUserCover();
	const { mutate: followUserMutation, isPending: followPending } = useFollowUser();
	const banUserMutation = useBanUser();
	const deleteUserMutation = useDeleteUserAdmin();
	const initiateConversationMutation = useInitiateConversation();

	const notifySuccess = useCallback((message: string) => toast.success(message), []);
	const notifyError = useCallback((message: string) => toast.error(message), []);

	const handleBanUser = () => {
		if (!profileData?.publicId) return;
		const reason = window.prompt("Enter ban reason:");
		if (reason) {
			banUserMutation.mutate({ publicId: profileData.publicId, reason }, {
				onSuccess: () => {
					queryClient.invalidateQueries({ queryKey: ["user", profileData.publicId] });
					queryClient.invalidateQueries({ queryKey: ["admin", "user", profileData.publicId] });
				}
			});
		}
	};

	const handleDeleteUser = () => {
		if (!profileData?.publicId) return;
		if (window.confirm("Are you sure you want to PERMANENTLY delete this user? This cannot be undone.")) {
			deleteUserMutation.mutate(profileData.publicId, {
				onSuccess: () => {
					navigate("/admin");
				}
			});
		}
	};

	const flattenedImages = imagesData?.pages?.flatMap((page) => page.data) || [];
	const flattenedLikedPosts = likedPostsData?.pages?.flatMap((page) => page.data) || [];
	const flattenedComments = commentsData?.pages?.flatMap((page) => page.comments) || [];
	const seoMetadata = buildProfileMetadata({
		id,
		handle: profileData?.handle,
		username: profileData?.username,
		bio: profileData?.bio,
	});

	const isLoadingAll = isLoadingImages || imagesData?.pages.length === 0;
	const isLoadingAllLiked = isLoadingLikedPosts || likedPostsData?.pages.length === 0;
	const isLoadingAllComments = isLoadingComments || commentsData?.pages.length === 0;

	const handleFollowUser = () => {
		if (!isLoggedIn) return navigate("/login");
		if (!profileUserId || !profileData) return;

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
	};

	const handleMessageUser = () => {
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
	};

	// Handler for Avatar upload
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
		[avatarMutation, notifyError, notifySuccess]
	);

	const handleCoverUpload = useCallback(
		(croppedImage: Blob | null) => {
			if (!croppedImage) {
				notifyError("Image processing failed.");
				setIsAvatarModalOpen(false);
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
		[coverMutation, notifyError, notifySuccess]
	);

	// Loading state
	if (isLoadingProfile) {
		return (
			<>
				<PageSeo {...seoMetadata} />
				<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "calc(100vh - 64px)" }}>
					<CircularProgress />
				</Box>
			</>
		);
	}

	if (getUserError) {
		return (
			<>
				<PageSeo {...seoMetadata} />
				<Box sx={{ p: 3, textAlign: "center" }}>
					<Typography color="error">We couldn't load this profile right now.</Typography>
				</Box>
			</>
		);
	}

	if (!profileData) {
		return (
			<>
				<PageSeo {...seoMetadata} />
				<Box
					sx={{
						p: { xs: 3, md: 6 },
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						minHeight: "60vh",
						textAlign: "center",
					}}
				>
					<Box
						sx={{
							maxWidth: 420,
							px: 3,
							py: 4,
							borderRadius: 4,
							border: `1px solid ${theme.palette.divider}`,
							bgcolor: alpha(theme.palette.background.default, 0.9),
							boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
						}}
					>
						<Typography variant="h5" fontWeight={800} gutterBottom>
							This profile doesn't exist
						</Typography>
						<Typography variant="body2" color="text.secondary">
							The handle might be wrong or the user has left
						</Typography>
						<Button variant="contained" sx={{ mt: 3, borderRadius: 9999, px: 3 }} onClick={() => navigate("/")}>
							Go home
						</Button>
					</Box>
				</Box>
			</>
		);
	}

	const getFullUrl = (urlPath: string | undefined): string | undefined => {
		if (!urlPath) return undefined;
		const imageUrl = urlPath.startsWith("http")
			? urlPath
			: urlPath.startsWith("/")
				? `${BASE_URL}${urlPath}`
				: `${BASE_URL}/${urlPath}`;
		return imageUrl;
	};

	const fullAvatarUrl = getFullUrl(profileData?.avatar);
	const fullCoverUrl = getFullUrl(profileData?.cover);

	return (
		<>
			<PageSeo {...seoMetadata} />
			<Box sx={{ minHeight: "100%", bgcolor: "background.default" }}>
			{/* Sticky Header */}
			<Box
				sx={{
					position: "sticky",
					top: 0,
					zIndex: 1000,
					bgcolor: "rgba(0, 0, 0, 0.65)",
					backdropFilter: "blur(12px)",
					borderBottom: `1px solid ${theme.palette.divider}`,
					px: 2,
					py: 0.5,
					display: "flex",
					alignItems: "center",
					gap: 3,
				}}
			>
				<IconButton onClick={() => navigate(-1)} size="small">
					<ArrowBackIcon />
				</IconButton>
				<Box>
					<Typography variant="h6" sx={{ lineHeight: 1.2 }}>
						{profileData.username}
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{flattenedImages.length} posts
					</Typography>
				</Box>
			</Box>

			{/* Cover Photo */}
			<Box
				sx={{
					position: "relative",
					height: { xs: 150, sm: 200 },
					bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.200",
					backgroundSize: "cover",
					backgroundPosition: "center",
					backgroundImage: fullCoverUrl ? `url(${fullCoverUrl})` : "none",
				}}
			>
				{/* Edit Cover Button */}
				{isProfileOwner && (
					<IconButton
						size="small"
						onClick={() => setIsCoverModalOpen(true)}
						sx={{
							position: "absolute",
							bottom: 16,
							right: 16,
							bgcolor: alpha(theme.palette.common.black, 0.5),
							color: theme.palette.common.white,
							"&:hover": {
								bgcolor: alpha(theme.palette.common.black, 0.7),
							},
						}}
					>
						<CameraAltIcon fontSize="small" />
					</IconButton>
				)}
			</Box>

			{/* Profile Info Section */}
			<Box sx={{ px: 2, pb: 2 }}>
				{/* Top Row: Avatar and Edit/Follow Button */}
				<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
					{/* Avatar Container */}
					<Box sx={{ mt: "-15%" }}>
						<Box sx={{ position: "relative", display: "inline-block" }}>
							<Avatar
								src={fullAvatarUrl}
								alt={`${profileData?.username}'s avatar`}
								sx={{
									width: { xs: 80, sm: 134 },
									height: { xs: 80, sm: 134 },
									border: `4px solid ${theme.palette.background.default}`,
								}}
							/>
							{isProfileOwner && (
								<IconButton
									size="small"
									onClick={() => setIsAvatarModalOpen(true)}
									sx={{
										position: "absolute",
										bottom: 0,
										right: 0,
										bgcolor: alpha(theme.palette.common.black, 0.5),
										color: theme.palette.common.white,
										"&:hover": { bgcolor: alpha(theme.palette.common.black, 0.7) },
									}}
								>
									<CameraAltIcon fontSize="small" />
								</IconButton>
							)}
						</Box>
					</Box>

					{/* Action Buttons */}
					<Box sx={{ mt: 1.5 }}>
						{isProfileOwner ? (
							<Button
								variant="outlined"
								onClick={() => setIsEditProfileOpen(true)}
								sx={{
									borderRadius: 9999,
									textTransform: "none",
									fontWeight: 700,
									borderColor: theme.palette.divider,
									color: theme.palette.text.primary,
									"&:hover": {
										bgcolor: alpha(theme.palette.text.primary, 0.1),
										borderColor: theme.palette.divider,
									},
								}}
							>
								{t("profile.edit_profile")}
							</Button>
						) : isLoggedIn ? (
							<Box sx={{ display: "flex", gap: 1 }}>
								<Tooltip title={t("profile.message")}>
									<IconButton
										onClick={handleMessageUser}
										sx={{
											border: `1px solid ${theme.palette.divider}`,
											color: theme.palette.text.primary,
										}}
									>
										<MailOutlineIcon />
									</IconButton>
								</Tooltip>
								<Button
									variant={isFollowing ? "outlined" : "contained"}
									onClick={handleFollowUser}
									disabled={isCheckingFollow || followPending}
									sx={{
										borderRadius: 9999,
										textTransform: "none",
										fontWeight: 700,
										minWidth: 100,
										bgcolor: isFollowing ? "transparent" : "common.white",
										color: isFollowing ? "text.primary" : "common.black",
										borderColor: isFollowing ? "divider" : "transparent",
										"&:hover": {
											bgcolor: isFollowing ? "rgba(244, 33, 46, 0.1)" : alpha(theme.palette.common.white, 0.9),
											color: isFollowing ? "error.main" : "common.black",
											borderColor: isFollowing ? "error.main" : "transparent",
										},
									}}
								>
									{isFollowing ? t("profile.unfollow") : t("profile.follow")}
								</Button>
								{user?.isAdmin && !isProfileOwner && (
									<>
										<Tooltip title="Account Details (Admin)">
											<IconButton
												onClick={() => navigate(`/admin/users/${profileData.publicId}`)}
												sx={{
													border: `1px solid ${theme.palette.divider}`,
													color: "info.main",
												}}
											>
												<InfoOutlinedIcon />
											</IconButton>
										</Tooltip>
										<Tooltip title="Ban User (Admin)">
											<IconButton
												onClick={handleBanUser}
												sx={{
													border: `1px solid ${theme.palette.divider}`,
													color: "warning.main",
												}}
											>
												<GavelIcon />
											</IconButton>
										</Tooltip>
										<Tooltip title="Delete User (Admin)">
											<IconButton
												onClick={handleDeleteUser}
												sx={{
													border: `1px solid ${theme.palette.divider}`,
													color: "error.main",
												}}
											>
												<DeleteForeverIcon />
											</IconButton>
										</Tooltip>
									</>
								)}
							</Box>
						) : (
							<Button
								variant="contained"
								onClick={() => navigate("/login")}
								sx={{
									borderRadius: 9999,
									bgcolor: "common.white",
									color: "common.black",
									fontWeight: 700,
									"&:hover": { bgcolor: alpha(theme.palette.common.white, 0.9) },
								}}
							>
								{t("profile.follow")}
							</Button>
						)}
					</Box>
				</Box>

				{/* Name and Handle */}
				<Box sx={{ mt: 1 }}>
					<Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
						{profileData.username}
					</Typography>
					<Typography variant="body2" color="text.secondary">
						@{profileData.handle}
					</Typography>
				</Box>

				{/* Bio */}
				{profileData.bio && (
					<Typography variant="body1" sx={{ mt: 1.5, whiteSpace: "pre-wrap" }}>
						{profileData.bio}
					</Typography>
				)}

				{/* Metadata (Join Date, etc) */}
				<Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1.5, color: "text.secondary" }}>
					<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
						<CalendarMonthIcon fontSize="small" />
						<Typography variant="body2">
							{t("profile.joined", {
								date: profileData.createdAt ? new Date(profileData.createdAt).toLocaleDateString() : "Unknown",
							})}
						</Typography>
					</Box>
				</Box>

				{/* Follow Counts */}
				<Box sx={{ display: "flex", gap: 2.5, mt: 1.5 }}>
					<Box
						sx={{ display: "flex", gap: 0.5, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
						onClick={() => navigate(`/profile/${profileData.handle}/follow?tab=following`)}
					>
						<Typography variant="body2" fontWeight={700} color="text.primary">
							{profileData.followingCount || 0}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{t("profile.following")}
						</Typography>
					</Box>
					<Box
						sx={{ display: "flex", gap: 0.5, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
						onClick={() => navigate(`/profile/${profileData.handle}/follow?tab=followers`)}
					>
						<Typography variant="body2" fontWeight={700} color="text.primary">
							{profileData.followerCount || 0}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{t("profile.followers")}
						</Typography>
					</Box>
				</Box>
			</Box>

			{/* Tabs Navigation */}
			<Box sx={{ borderBottom: 1, borderColor: "divider" }}>
				<Tabs
					value={activeTab}
					onChange={(_, newValue) => setActiveTab(newValue)}
					variant="fullWidth"
					textColor="inherit"
					indicatorColor="primary"
					sx={{
						"& .MuiTab-root": {
							textTransform: "none",
							fontWeight: 700,
							fontSize: "0.95rem",
							minHeight: 53,
							color: "text.secondary",
							"&:hover": {
								bgcolor: alpha(theme.palette.text.primary, 0.1),
							},
							"&.Mui-selected": {
								color: "text.primary",
							},
						},
						"& .MuiTabs-indicator": {
							height: 4,
							borderRadius: 2,
						},
					}}
				>
					<Tab label={t("profile.posts")} />
					<Tab label={t("profile.replies")} />
					<Tab label={t("profile.media")} />
					<Tab label={t("profile.likes")} />
				</Tabs>
			</Box>

			{/* Feed Content */}
			<Box>
				{activeTab === 0 && (
					<>
						{flattenedImages.length === 0 && !isLoadingImages ? (
							<Box sx={{ p: 4, textAlign: "center" }}>
								<Typography variant="h6" fontWeight={700} gutterBottom>
									{t("profile.no_posts_user", { username: profileData.handle })}
								</Typography>
								<Typography variant="body2" color="text.secondary">
									{t("profile.no_posts_desc")}
								</Typography>
							</Box>
						) : (
							<Gallery
								posts={flattenedImages}
								fetchNextPage={fetchNextPage}
								hasNextPage={!!hasNextPage}
								isFetchingNext={isFetchingNextPage}
								isLoadingAll={isLoadingAll}
							/>
						)}
					</>
				)}
				{activeTab === 1 && (
					<Box sx={{ p: 2 }}>
						{flattenedComments.length === 0 && !isLoadingComments ? (
							<Box sx={{ p: 4, textAlign: "center" }}>
								<Typography variant="h6" fontWeight={700} gutterBottom>
									{t("profile.no_replies_user", { username: profileData.handle })}
								</Typography>
							</Box>
						) : (
							<Box>
								{isLoadingAllComments && (
									<Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
										<CircularProgress />
									</Box>
								)}
								{flattenedComments.map((comment) => {
									const typedComment = comment as {
										id: string;
										content: string;
										postPublicId: string;
										createdAt: string;
									};
									return (
										<Paper key={typedComment.id} sx={{ p: 2, mb: 2 }}>
											<Typography variant="body1" sx={{ mb: 1 }}>
												{typedComment.content}
											</Typography>
											<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
												<Typography
													variant="caption"
													color="primary"
													sx={{
														cursor: "pointer",
														fontWeight: 600,
														"&:hover": { textDecoration: "underline" },
													}}
													onClick={() => navigate(`/posts/${typedComment.postPublicId}`)}
												>
													{t("profile.view_post")}
												</Typography>
												<Typography variant="caption" color="text.secondary">
													{new Date(typedComment.createdAt).toLocaleDateString(undefined, {
														year: "numeric",
														month: "short",
														day: "numeric",
													})}
												</Typography>
											</Box>
										</Paper>
									);
								})}
								{hasNextCommentsPage && (
									<Button onClick={() => fetchNextCommentsPage()} disabled={isFetchingNextCommentsPage}>
										{isFetchingNextCommentsPage ? t("common.loading") : t("profile.load_more")}
									</Button>
								)}
							</Box>
						)}
					</Box>
				)}
				{activeTab === 2 && (
					<>
						{flattenedImages.length === 0 && !isLoadingImages ? (
							<Box sx={{ p: 4, textAlign: "center" }}>
								<Typography variant="h6" fontWeight={700} gutterBottom>
									{t("profile.no_media_user", { username: profileData.handle })}
								</Typography>
							</Box>
						) : (
							<Gallery
								posts={flattenedImages.filter((post) => post.image)}
								fetchNextPage={fetchNextPage}
								hasNextPage={!!hasNextPage}
								isFetchingNext={isFetchingNextPage}
								isLoadingAll={isLoadingAll}
								variant="media"
							/>
						)}
					</>
				)}
				{activeTab === 3 && (
					<>
						{flattenedLikedPosts.length === 0 && !isLoadingLikedPosts ? (
							<Box sx={{ p: 4, textAlign: "center" }}>
								<Typography variant="h6" fontWeight={700} gutterBottom>
									{t("profile.no_likes_user", { username: profileData.handle })}
								</Typography>
							</Box>
						) : (
							<Gallery
								posts={flattenedLikedPosts}
								fetchNextPage={fetchNextLikedPage}
								hasNextPage={!!hasNextLikedPage}
								isFetchingNext={isFetchingNextLikedPage}
								isLoadingAll={isLoadingAllLiked}
							/>
						)}
					</>
				)}
			</Box>

			{/* Modals */}
			<Modal
				open={isAvatarModalOpen}
				onClose={() => setIsAvatarModalOpen(false)}
				sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
			>
				<Paper sx={{ p: 3, borderRadius: 4, maxWidth: 500, width: "100%" }}>
					<Typography variant="h6" gutterBottom fontWeight={700}>
						{t("profile.update_avatar")}
					</Typography>
					<ImageEditor type="avatar" onImageUpload={handleAvatarUpload} onClose={() => setIsAvatarModalOpen(false)} />
				</Paper>
			</Modal>

			<Modal
				open={isCoverModalOpen}
				onClose={() => setIsCoverModalOpen(false)}
				sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
			>
				<Paper sx={{ p: 3, borderRadius: 4, maxWidth: 600, width: "100%" }}>
					<Typography variant="h6" gutterBottom fontWeight={700}>
						{t("profile.update_cover")}
					</Typography>
					<ImageEditor
						type="cover"
						aspectRatio={3}
						onImageUpload={handleCoverUpload}
						onClose={() => setIsCoverModalOpen(false)}
					/>
				</Paper>
			</Modal>

			<Modal
				open={isEditProfileOpen}
				onClose={() => setIsEditProfileOpen(false)}
				sx={{ display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}
			>
				<Paper sx={{ p: 3, borderRadius: 4, maxWidth: 600, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
					<Typography variant="h6" gutterBottom fontWeight={700}>
						{t("profile.edit_profile")}
					</Typography>
					<EditProfile
						onComplete={() => setIsEditProfileOpen(false)}
						notifySuccess={notifySuccess}
						notifyError={notifyError}
						initialData={profileData}
					/>
				</Paper>
			</Modal>

			<ToastContainer
				position="bottom-right"
				autoClose={3000}
				theme={theme.palette.mode === "dark" ? "dark" : "light"}
			/>
			</Box>
		</>
	);
};

export default Profile;
