import { Box, Button, CircularProgress, Paper, Tab, Tabs, Typography, alpha, useTheme } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Gallery from "../../components/Gallery";
import { IComment, IPost } from "../../types";

interface ProfileTabPanelsProps {
	activeTab: number;
	onTabChange: (value: number) => void;
	profileHandle: string;
	posts: IPost[];
	likedPosts: IPost[];
	comments: IComment[];
	isLoadingImages: boolean;
	isLoadingAllPosts: boolean;
	isLoadingAllLiked: boolean;
	isLoadingComments: boolean;
	isLoadingAllComments: boolean;
	hasNextPostsPage: boolean;
	hasNextLikedPage: boolean;
	hasNextCommentsPage: boolean;
	isFetchingNextPostsPage: boolean;
	isFetchingNextLikedPage: boolean;
	isFetchingNextCommentsPage: boolean;
	onFetchNextPostsPage: () => void;
	onFetchNextLikedPage: () => void;
	onFetchNextCommentsPage: () => void;
}

export const ProfileTabPanels: React.FC<ProfileTabPanelsProps> = ({
	activeTab,
	onTabChange,
	profileHandle,
	posts,
	likedPosts,
	comments,
	isLoadingImages,
	isLoadingAllPosts,
	isLoadingAllLiked,
	isLoadingComments,
	isLoadingAllComments,
	hasNextPostsPage,
	hasNextLikedPage,
	hasNextCommentsPage,
	isFetchingNextPostsPage,
	isFetchingNextLikedPage,
	isFetchingNextCommentsPage,
	onFetchNextPostsPage,
	onFetchNextLikedPage,
	onFetchNextCommentsPage,
}) => {
	const theme = useTheme();
	const navigate = useNavigate();
	const { t } = useTranslation();
	const mediaPosts = posts.filter((post) => post.image);

	return (
		<>
			<Box sx={{ borderBottom: 1, borderColor: "divider" }}>
				<Tabs
					value={activeTab}
					onChange={(_event, nextValue) => onTabChange(nextValue)}
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

			<Box>
				{activeTab === 0 &&
					(posts.length === 0 && !isLoadingImages ? (
						<Box sx={{ p: 4, textAlign: "center" }}>
							<Typography variant="h6" fontWeight={700} gutterBottom>
								{t("profile.no_posts_user", { username: profileHandle })}
							</Typography>
							<Typography variant="body2" color="text.secondary">
								{t("profile.no_posts_desc")}
							</Typography>
						</Box>
					) : (
						<Gallery
							posts={posts}
							fetchNextPage={onFetchNextPostsPage}
							hasNextPage={hasNextPostsPage}
							isFetchingNext={isFetchingNextPostsPage}
							isLoadingAll={isLoadingAllPosts}
						/>
					))}

				{activeTab === 1 && (
					<Box sx={{ p: 2 }}>
						{comments.length === 0 && !isLoadingComments ? (
							<Box sx={{ p: 4, textAlign: "center" }}>
								<Typography variant="h6" fontWeight={700} gutterBottom>
									{t("profile.no_replies_user", { username: profileHandle })}
								</Typography>
							</Box>
						) : (
							<Box>
								{isLoadingAllComments && (
									<Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
										<CircularProgress />
									</Box>
								)}
								{comments.map((comment) => (
									<Paper key={comment.id} sx={{ p: 2, mb: 2 }}>
										<Typography variant="body1" sx={{ mb: 1 }}>
											{comment.content}
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
												onClick={() => navigate(`/posts/${comment.postPublicId}`)}
											>
												{t("profile.view_post")}
											</Typography>
											<Typography variant="caption" color="text.secondary">
												{new Date(comment.createdAt).toLocaleDateString(undefined, {
													year: "numeric",
													month: "short",
													day: "numeric",
												})}
											</Typography>
										</Box>
									</Paper>
								))}
								{hasNextCommentsPage && (
									<Button onClick={onFetchNextCommentsPage} disabled={isFetchingNextCommentsPage}>
										{isFetchingNextCommentsPage ? t("common.loading") : t("profile.load_more")}
									</Button>
								)}
							</Box>
						)}
					</Box>
				)}

				{activeTab === 2 &&
					(mediaPosts.length === 0 && !isLoadingImages ? (
						<Box sx={{ p: 4, textAlign: "center" }}>
							<Typography variant="h6" fontWeight={700} gutterBottom>
								{t("profile.no_media_user", { username: profileHandle })}
							</Typography>
						</Box>
					) : (
						<Gallery
							posts={mediaPosts}
							fetchNextPage={onFetchNextPostsPage}
							hasNextPage={hasNextPostsPage}
							isFetchingNext={isFetchingNextPostsPage}
							isLoadingAll={isLoadingAllPosts}
							variant="media"
						/>
					))}

				{activeTab === 3 &&
					(likedPosts.length === 0 && !isLoadingAllLiked ? (
						<Box sx={{ p: 4, textAlign: "center" }}>
							<Typography variant="h6" fontWeight={700} gutterBottom>
								{t("profile.no_likes_user", { username: profileHandle })}
							</Typography>
						</Box>
					) : (
						<Gallery
							posts={likedPosts}
							fetchNextPage={onFetchNextLikedPage}
							hasNextPage={hasNextLikedPage}
							isFetchingNext={isFetchingNextLikedPage}
							isLoadingAll={isLoadingAllLiked}
						/>
					))}
			</Box>
		</>
	);
};
