import React from "react";
import { Box, alpha, useTheme } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IPost } from "../types";
import {
	useDeletePost,
	useRepostPost,
	useUnrepostPost,
} from "../hooks/posts/usePosts";
import { useAuth } from "../hooks/context/useAuth";
import { PostCardBody } from "./post-card/PostCardBody";
import { PostCardCommunityBadge } from "./post-card/PostCardCommunityBadge";
import { PostCardHeader } from "./post-card/PostCardHeader";
import { PostCardImage } from "./post-card/PostCardImage";
import { PostCardRepostPreview } from "./post-card/PostCardRepostPreview";
import { PostCardStats } from "./post-card/PostCardStats";
import { buildPostCardMedia } from "./post-card/postCardMedia";

interface PostCardProps {
	post: IPost;
	prioritizeImage?: boolean;
}

const PostCard: React.FC<PostCardProps> = ({ post, prioritizeImage = false }) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const theme = useTheme();
	const { isLoggedIn, user } = useAuth();
	const { mutate: triggerRepost } = useRepostPost();
	const { mutate: triggerUnrepost } = useUnrepostPost();
	const { mutate: deletePost } = useDeletePost();

	const isAdmin = !!user?.isAdmin;
	const isOwnRepost = post.type === "repost" && post.user?.publicId === user?.publicId;
	const hasReposted = isOwnRepost || post.isRepostedByViewer;
	const media = buildPostCardMedia(post);

	const handleDeletePost = (event: React.MouseEvent) => {
		event.stopPropagation();
		if (
			window.confirm(
				t("post.confirm_delete", {
					defaultValue: "Are you sure you want to delete this post?",
				}),
			)
		) {
			deletePost(post.publicId);
		}
	};

	const handleRepostClick = (event: React.MouseEvent) => {
		event.stopPropagation();
		if (!isLoggedIn) {
			navigate("/login");
			return;
		}

		const targetId =
			post.type === "repost" && post.repostOf?.publicId
				? post.repostOf.publicId
				: post.publicId;

		if (hasReposted) {
			triggerUnrepost({ postPublicId: targetId });
			return;
		}

		triggerRepost({ postPublicId: targetId });
	};

	return (
		<Box
			sx={{
				width: { xs: "100%", sm: "calc(100% - 24px)" },
				mx: { xs: 0, sm: 1.5 },
				mt: { xs: 0, sm: 1.5 },
				border: { xs: "none", sm: `1px solid ${theme.palette.divider}` },
				borderBottom: { xs: `1px solid ${theme.palette.divider}`, sm: undefined },
				borderRadius: { xs: 0, sm: 4 },
				overflow: "hidden",
				bgcolor: alpha(theme.palette.background.paper, 0.58),
				boxShadow: { xs: "none", sm: "0 16px 45px rgba(0, 0, 0, 0.12)" },
				cursor: "pointer",
				transition: "background-color 0.2s, border-color 0.2s, transform 0.2s",
				"&:hover": {
					bgcolor: alpha(theme.palette.background.paper, 0.82),
					borderColor: alpha(theme.palette.primary.main, 0.28),
					transform: { xs: "none", sm: "translateY(-1px)" },
				},
			}}
			onClick={() => navigate(`/posts/${post.publicId}`)}
		>
			<PostCardCommunityBadge
				post={post}
				communityAvatarUrl={media.communityAvatarUrl}
			/>
			<PostCardHeader
				post={post}
				avatarUrl={media.userAvatarUrl}
				hasCommunity={!!post.community}
				isAdmin={isAdmin}
				onDeleteClick={handleDeletePost}
			>
				<PostCardBody body={post.body} hasImage={media.hasImage} />
				<PostCardImage
					imageUrl={media.postImageUrl}
					srcSet={media.postImageSrcSet}
					alt={post.body?.substring(0, 50) || post.publicId}
					prioritizeImage={prioritizeImage && media.hasImage}
				/>
				<PostCardRepostPreview
					post={post}
					repostAvatarUrl={media.repostAvatarUrl}
					repostImageUrl={media.repostImageUrl}
					repostImageSrcSet={media.repostImageSrcSet}
				/>
				<PostCardStats
					post={post}
					hasReposted={hasReposted}
					onRepostClick={handleRepostClick}
				/>
			</PostCardHeader>
		</Box>
	);
};

export default PostCard;
