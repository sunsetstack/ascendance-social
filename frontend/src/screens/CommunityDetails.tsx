import React, { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box, Typography, Button, Container, CircularProgress, Paper, Avatar, IconButton } from "@mui/material";
import { Edit as EditIcon } from "@mui/icons-material";
import { useCommunity, useJoinCommunity, useLeaveCommunity } from "../hooks/communities/useCommunity";
import { useCommunityPosts } from "../hooks/communities/useCommunityPosts";
import Gallery from "../components/Gallery";
import CreatePost from "../components/CreatePost";
import EditCommunityModal from "../components/EditCommunityModal";
import { useAuth } from "../hooks/context/useAuth";
import { PageSeo } from "../lib/PageSeo";
import { buildCommunityMetadata } from "../lib/seo";

const CommunityDetails: React.FC = () => {
	const { slug } = useParams<{ slug: string }>();
	const navigate = useNavigate();
	const { data: community, isLoading: isCommunityLoading } = useCommunity(slug);
	const { isLoggedIn } = useAuth();
	const [editModalOpen, setEditModalOpen] = useState(false);

	const {
		data: postsData,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		isLoading: isPostsLoading,
	} = useCommunityPosts(community?.publicId);

	const { mutate: joinCommunity, isPending: isJoining } = useJoinCommunity();
	const { mutate: leaveCommunity, isPending: isLeaving } = useLeaveCommunity();

	const activePosts = useMemo(() => postsData?.pages.flatMap((p) => p.data) ?? [], [postsData]);

	if (isCommunityLoading) {
		return (
			<>
				<PageSeo {...buildCommunityMetadata({ slug })} />
				<Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
					<CircularProgress />
				</Box>
			</>
		);
	}

	if (!community) {
		return (
			<>
				<PageSeo {...buildCommunityMetadata({ slug })} />
				<Container maxWidth="md" sx={{ py: 4 }}>
					<Typography variant="h5" align="center">
						Community not found
					</Typography>
				</Container>
			</>
		);
	}

	const handleJoinLeave = () => {
		if (community.isMember) {
			leaveCommunity(community.publicId);
		} else {
			joinCommunity(community.publicId);
		}
	};

	const getCoverPhotoUrl = () => {
		if (!community.coverPhoto) return undefined;
		return community.coverPhoto.startsWith("http") ? community.coverPhoto : `/api/${community.coverPhoto}`;
	};

	const getAvatarUrl = () => {
		if (!community.avatar) return undefined;
		return community.avatar.startsWith("http") ? community.avatar : `/api/${community.avatar}`;
	};

	const coverPhotoUrl = getCoverPhotoUrl();

	return (
		<>
			<PageSeo {...buildCommunityMetadata({ slug, name: community.name, description: community.description })} />
			<Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
				{/* Banner / Cover Photo */}
				<Box
					sx={{
						height: 200,
						bgcolor: "grey.800",
						background: coverPhotoUrl ? `url(${coverPhotoUrl})` : "linear-gradient(45deg, #2196F3 30%, #21CBF3 90%)",
						backgroundSize: "cover",
						backgroundPosition: "center",
						position: "relative",
					}}
				>
					{/* Edit button overlay for admins */}
					{community.isAdmin && (
						<IconButton
							onClick={() => setEditModalOpen(true)}
							sx={{
								position: "absolute",
								right: 16,
								top: 16,
								bgcolor: "rgba(0,0,0,0.5)",
								"&:hover": { bgcolor: "rgba(0,0,0,0.7)" },
							}}
						>
							<EditIcon />
						</IconButton>
					)}
				</Box>

				<Container maxWidth="md" sx={{ mt: -5 }}>
					<Paper sx={{ p: 3, mb: 4, position: "relative", borderRadius: 2, backgroundColor: "transparent" }}>
						<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
							<Box sx={{ mt: -8 }}>
								<Avatar
									src={getAvatarUrl()}
									sx={{
										width: 120,
										height: 120,
										border: "4px solid",
										borderColor: "background.paper",
										bgcolor: "primary.main",
										fontSize: "3rem",
									}}
								>
									{community.name.charAt(0).toUpperCase()}
								</Avatar>
							</Box>
							<Box sx={{ mt: 2, display: "flex", gap: 1 }}>
								{community.isAdmin && (
									<Button
										variant="outlined"
										onClick={() => setEditModalOpen(true)}
										sx={{ borderRadius: 20, textTransform: "none", fontWeight: "bold" }}
									>
										Edit
									</Button>
								)}
								{isLoggedIn && (
									<Button
										variant={community.isMember ? "outlined" : "contained"}
										onClick={handleJoinLeave}
										disabled={isJoining || isLeaving}
										sx={{ borderRadius: 20, textTransform: "none", fontWeight: "bold" }}
									>
										{community.isMember ? "Leave" : "Join"}
									</Button>
								)}
							</Box>
						</Box>

						<Box sx={{ mt: 2 }}>
							<Typography variant="h4" component="h1" fontWeight="bold" gutterBottom>
								{community.name}
							</Typography>
							<Typography variant="body1" color="text.secondary" paragraph>
								{community.description}
							</Typography>
							<Box sx={{ display: "flex", gap: 2, alignItems: "center" }}>
								<Box
									sx={{
										display: "flex",
										gap: 0.5,
										cursor: "pointer",
										"&:hover": { textDecoration: "underline" },
									}}
									onClick={() => navigate(`/communities/${slug}/members`)}
								>
									<Typography variant="body2" fontWeight="bold" color="text.primary">
										{community.stats.memberCount}
									</Typography>
									<Typography variant="body2" color="text.secondary">
										members
									</Typography>
								</Box>
								<Box sx={{ display: "flex", gap: 0.5 }}>
									<Typography variant="body2" fontWeight="bold" color="text.primary">
										{community.stats.postCount}
									</Typography>
									<Typography variant="body2" color="text.secondary">
										posts
									</Typography>
								</Box>
							</Box>
						</Box>
					</Paper>

					{/* Post creation prompt for community members */}
					{isLoggedIn && community.isMember && (
						<Paper sx={{ mb: 4, p: 2, borderRadius: 2, backgroundColor: "transparent" }}>
							<CreatePost defaultCommunityPublicId={community.publicId} />
						</Paper>
					)}

					<Box>
						<Typography variant="h5" sx={{ mb: 2, fontWeight: "bold" }}>
							Posts
						</Typography>
						<Gallery
							posts={activePosts}
							fetchNextPage={fetchNextPage}
							hasNextPage={hasNextPage}
							isFetchingNext={isFetchingNextPage}
							isLoadingAll={isPostsLoading}
							emptyTitle="No posts yet"
							emptyDescription="Be the first to post in this community!"
						/>
					</Box>
				</Container>

				{/* Edit Community Modal */}
				{community.isAdmin && (
					<EditCommunityModal open={editModalOpen} onClose={() => setEditModalOpen(false)} community={community} />
				)}
			</Box>
		</>
	);
};

export default CommunityDetails;
