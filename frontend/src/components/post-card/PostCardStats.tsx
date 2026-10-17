import { Box, ButtonBase, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CommentIcon from "@mui/icons-material/Comment";
import VisibilityIcon from "@mui/icons-material/Visibility";
import RepeatIcon from "@mui/icons-material/Repeat";
import { IPost } from "../../types";
import { formatCount } from "./postCard.utils";

interface PostCardStatsProps {
	post: IPost;
	hasReposted: boolean;
	isReposting: boolean;
	onRepostClick: (event: React.MouseEvent) => void;
	onOpen?: (postPublicId: string) => void;
  onLikeClick?: (event: React.MouseEvent) => void;
  isLiking?: boolean;
}

export const PostCardStats: React.FC<PostCardStatsProps> = ({
	post,
	hasReposted,
	isReposting,
	onRepostClick,
	onOpen,
  onLikeClick,
  isLiking,
}) => {
	const { t } = useTranslation();
	return (
		<Box
			sx={{
				display: "flex",
				justifyContent: "space-between",
				maxWidth: 520,
				mt: 1.75,
				mx: -0.75,
			}}
		>
      <ButtonBase
        component={onLikeClick ? "button" : "span"}
				role={onLikeClick ? "button" : "img"}
        onClick={onLikeClick}
        disabled={!onLikeClick || isLiking}
        aria-pressed={onLikeClick ? post.isLikedByViewer : undefined}
				aria-label={`${post.likes || 0} ${t("post.likes")}`}
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: post.isLikedByViewer ? "error.main" : "text.secondary",
				}}
			>
				<FavoriteIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.likes || 0)}</Typography>
			</ButtonBase>
			<ButtonBase
				aria-label={t(hasReposted ? "post.undo_repost" : "post.repost")}
				aria-pressed={!!hasReposted}
				disabled={isReposting}
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					minHeight: 40,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: hasReposted ? "#22c55e" : "text.secondary",
					"&:hover": { color: "#22c55e", bgcolor: "rgba(34, 197, 94, 0.1)" },
					"&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
					cursor: "pointer",
				}}
				onClick={onRepostClick}
			>
				<RepeatIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.repostCount || 0)}</Typography>
			</ButtonBase>
			<ButtonBase
				component={RouterLink}
				to={`/posts/${post.publicId}#comments`}
				aria-label={t("post.view_comments", { count: post.commentsCount || 0 })}
				onClick={(event) => {
					event.stopPropagation();
					onOpen?.(post.publicId);
				}}
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					minHeight: 40,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: "text.secondary",
					"&:hover": { color: "#38bdf8", bgcolor: "rgba(56, 189, 248, 0.1)" },
					"&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
				}}
			>
				<CommentIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.commentsCount || 0)}</Typography>
			</ButtonBase>
			<Box
				role="img"
				aria-label={`${post.viewsCount || 0} ${t("post.views")}`}
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: "text.secondary",
				}}
			>
				<VisibilityIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.viewsCount || 0)}</Typography>
			</Box>
		</Box>
	);
};
