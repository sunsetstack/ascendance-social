import React, { useState } from "react";
import { Alert, Box, alpha, useTheme } from "@mui/material";
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
import { useLikePost } from "../hooks/user/useUserAction";
import { Typography } from "@mui/material";

interface PostCardProps {
	post: IPost;
	prioritizeImage?: boolean;
	onOpen?: (postPublicId: string) => void;
}

const PostCard: React.FC<PostCardProps> = ({
	post,
	prioritizeImage = false,
	onOpen,
}) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const theme = useTheme();
	const { isLoggedIn, user } = useAuth();
	const { mutate: triggerRepost, isPending: isReposting } = useRepostPost();
	const { mutate: triggerUnrepost, isPending: isUnreposting } = useUnrepostPost();
	const [repostFailed, setRepostFailed] = useState(false);
	const { mutate: deletePost } = useDeletePost();
  const like = useLikePost();
  const handleLikeClick = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (!isLoggedIn) { navigate("/login"); return; }
    like.mutate(post.publicId);
  };

	const isAdmin = !!user?.isAdmin;
	const isOwnRepost = post.type === "repost" && post.user?.publicId === user?.publicId;
	const hasReposted = isOwnRepost || post.isRepostedByViewer;
	const media = buildPostCardMedia(post);
  const [reason, match] = post.feedReason?.split(":") ?? [];

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
		setRepostFailed(false);
		if (!isLoggedIn) {
			navigate("/login");
			return;
		}

		const targetId =
			post.type === "repost" && post.repostOf?.publicId
				? post.repostOf.publicId
				: post.publicId;

		if (hasReposted) {
			triggerUnrepost({ postPublicId: targetId }, { onError: () => setRepostFailed(true) });
			return;
		}

		triggerRepost({ postPublicId: targetId }, { onError: () => setRepostFailed(true) });
	};

	return (
		<Box
			component="article"
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
			data-feed-card-id={post.publicId}
			onClick={() => {
				onOpen?.(post.publicId);
				navigate(`/posts/${post.publicId}`);
			}}
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
				onOpen={onOpen}
				media={
					media.hasImage ? (
						<PostCardImage
							imageUrl={media.postImageUrl}
							srcSet={media.postImageSrcSet}
							alt={post.body?.substring(0, 50) || post.publicId}
							width={post.image?.width}
							height={post.image?.height}
							prioritizeImage={prioritizeImage}
						/>
					) : undefined
				}
				footer={
					<>
						<PostCardStats
							post={post}
							hasReposted={hasReposted}
              onLikeClick={post.viewerLikeStateKnown ? handleLikeClick : undefined}
              isLiking={like.isPending}
							isReposting={isReposting || isUnreposting}
							onRepostClick={handleRepostClick}
							onOpen={onOpen}
						/>
						{repostFailed && (
							<Alert severity="error" sx={{ mt: 1 }}>{t("post.repost_failed")}</Alert>
						)}
            {like.isError && <Alert severity="error">{t("interests.like_failed")}</Alert>}
					</>
				}
			>
				<PostCardBody body={post.body} hasImage={media.hasImage} />
        {reason && <Typography variant="caption" color="text.secondary">{t(`feed_reasons.${reason}`, {
          topic: match ? t(`interest_names.${match}`) : "", format: match ? t(`content_formats.${match}`) : "",
        })}</Typography>}
        {!reason && !!post.contentTopics?.length && <Typography variant="caption" color="text.secondary">
          {t("interests.about", { topics: post.contentTopics.map((id) => t(`interest_names.${id}`)).join(", ") })}
        </Typography>}
				<PostCardRepostPreview
					post={post}
					repostAvatarUrl={media.repostAvatarUrl}
					repostImageUrl={media.repostImageUrl}
					repostImageSrcSet={media.repostImageSrcSet}
					repostImageWidth={post.repostOf?.image?.width}
					repostImageHeight={post.repostOf?.image?.height}
					onOpen={onOpen}
				/>
			</PostCardHeader>
		</Box>
	);
};

export default React.memo(PostCard);
