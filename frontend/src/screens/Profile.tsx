import { Box, useTheme } from "@mui/material";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { PageSeo } from "../lib/PageSeo";
import { ProfileErrorState, ProfileLoadingState, ProfileMissingState } from "./profile/ProfileStates";
import { ProfileHero } from "./profile/ProfileHero";
import { ProfileModals } from "./profile/ProfileModals";
import { ProfileTabPanels } from "./profile/ProfileTabPanels";
import { useProfileController } from "./profile/useProfileController";

const Profile: React.FC = () => {
	const theme = useTheme();
	const controller = useProfileController();

	if (controller.isLoadingProfile) {
		return <ProfileLoadingState seoMetadata={controller.seoMetadata} />;
	}

	if (controller.getUserError) {
		return <ProfileErrorState seoMetadata={controller.seoMetadata} />;
	}

	if (!controller.profileData) {
		return (
			<ProfileMissingState
				seoMetadata={controller.seoMetadata}
				onGoHome={controller.navigateHome}
			/>
		);
	}

	return (
		<>
			<PageSeo {...controller.seoMetadata} />
			<Box sx={{ minHeight: "100%", bgcolor: "background.default" }}>
				<ProfileHero
					profileData={controller.profileData}
					fullAvatarUrl={controller.fullAvatarUrl}
					fullCoverUrl={controller.fullCoverUrl}
					isProfileOwner={controller.isProfileOwner}
					isLoggedIn={controller.isLoggedIn}
					isFollowing={controller.isFollowing}
					isCheckingFollow={controller.isCheckingFollow}
					followPending={controller.followPending}
					postCount={controller.flattenedImages.length}
					viewerIsAdmin={!!controller.user?.isAdmin}
					onBack={controller.navigateBack}
					onOpenCoverModal={() => controller.setIsCoverModalOpen(true)}
					onOpenAvatarModal={() => controller.setIsAvatarModalOpen(true)}
					onOpenEditProfile={() => controller.setIsEditProfileOpen(true)}
					onFollow={controller.handleFollowUser}
					onMessage={controller.handleMessageUser}
					onOpenAdminDetails={controller.navigateToAdminDetails}
					onBanUser={controller.handleBanUser}
					onDeleteUser={controller.handleDeleteUser}
				/>

				<ProfileTabPanels
					activeTab={controller.activeTab}
					onTabChange={controller.setActiveTab}
					profileHandle={controller.profileData.handle}
					posts={controller.flattenedImages}
					likedPosts={controller.flattenedLikedPosts}
					comments={controller.flattenedComments}
					isLoadingImages={controller.isLoadingImages}
					isLoadingAllPosts={controller.isLoadingAllPosts}
					isLoadingAllLiked={controller.isLoadingAllLiked}
					isLoadingComments={controller.isLoadingComments}
					isLoadingAllComments={controller.isLoadingAllComments}
					hasNextPostsPage={controller.hasNextPage}
					hasNextLikedPage={controller.hasNextLikedPage}
					hasNextCommentsPage={controller.hasNextCommentsPage}
					isFetchingNextPostsPage={controller.isFetchingNextPage}
					isFetchingNextLikedPage={controller.isFetchingNextLikedPage}
					isFetchingNextCommentsPage={controller.isFetchingNextCommentsPage}
					onFetchNextPostsPage={() => {
						void controller.fetchNextPage();
					}}
					onFetchNextLikedPage={() => {
						void controller.fetchNextLikedPage();
					}}
					onFetchNextCommentsPage={() => {
						void controller.fetchNextCommentsPage();
					}}
				/>

				<ProfileModals
					isAvatarModalOpen={controller.isAvatarModalOpen}
					isCoverModalOpen={controller.isCoverModalOpen}
					isEditProfileOpen={controller.isEditProfileOpen}
					initialData={controller.profileData}
					onCloseAvatarModal={() => controller.setIsAvatarModalOpen(false)}
					onCloseCoverModal={() => controller.setIsCoverModalOpen(false)}
					onCloseEditProfile={() => controller.setIsEditProfileOpen(false)}
					onAvatarUpload={controller.handleAvatarUpload}
					onCoverUpload={controller.handleCoverUpload}
					notifySuccess={controller.notifySuccess}
					notifyError={controller.notifyError}
				/>

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
