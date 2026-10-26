import { Box, ButtonBase, Typography } from "@mui/material";
import { Eye, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IPost } from "../../types";
import { formatCount } from "./postCard.utils";

interface PostCardStatsProps {
	post: IPost;
	hasReposted: boolean;
	isReposting?: boolean;
	onRepostClick: (event: React.MouseEvent) => void;
	onOpen?: (postPublicId: string) => void;
	onLikeClick?: (event: React.MouseEvent) => void;
	isLiking?: boolean;
}

export const PostCardStats: React.FC<PostCardStatsProps> = ({
	post, hasReposted, isReposting, onRepostClick, onOpen, onLikeClick, isLiking,
}) => {
	const { t } = useTranslation();
	const actionSx = {
		display: "flex", alignItems: "center", gap: 0.75, minWidth: 36, minHeight: 40,
		px: 0.75, py: 0.5, borderRadius: 2, color: "text.secondary",
		"&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
	};
	return (
		<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 0.5, mt: 1.5, mx: -0.75 }}>
			<ButtonBase component={RouterLink} to={`/posts/${post.publicId}#comments`} aria-label={t("post.view_comments", { count: post.commentsCount || 0 })}
				onClick={(event) => { event.stopPropagation(); onOpen?.(post.publicId); }}
				sx={{ ...actionSx, "&:hover": { color: "primary.main", bgcolor: "action.selected" } }}>
				<MessageCircle size={18} strokeWidth={1.6} /><Typography variant="caption">{t("timeline.replies", { count: post.commentsCount || 0 })}</Typography>
			</ButtonBase>
			<ButtonBase component={onLikeClick ? "button" : "span"} role={onLikeClick ? "button" : "img"} onClick={onLikeClick}
				disabled={!onLikeClick || isLiking} aria-pressed={onLikeClick ? post.isLikedByViewer : undefined}
				aria-label={`${post.likes || 0} ${t("post.likes")}`}
				sx={{ ...actionSx, color: post.isLikedByViewer ? "error.main" : "text.secondary", "&:hover": { color: "error.main", bgcolor: "rgba(244, 33, 46, 0.1)" } }}>
				<Heart size={18} strokeWidth={1.6} fill={post.isLikedByViewer ? "currentColor" : "none"} /><Typography variant="caption">{formatCount(post.likes || 0)}</Typography>
			</ButtonBase>
			<ButtonBase aria-label={t(hasReposted ? "post.undo_repost" : "post.repost")} aria-pressed={!!hasReposted}
				disabled={isReposting} onClick={onRepostClick}
				sx={{ ...actionSx, color: hasReposted ? "#57d5a1" : "text.secondary", "&:hover": { color: "#57d5a1", bgcolor: "rgba(87, 213, 161, 0.1)" } }}>
				<Repeat2 size={18} strokeWidth={1.6} /><Typography variant="caption">{formatCount(post.repostCount || 0)}</Typography>
			</ButtonBase>
			<Box role="img" aria-label={`${post.viewsCount || 0} ${t("post.views")}`} sx={actionSx}>
				<Eye size={18} strokeWidth={1.6} /><Typography variant="caption">{formatCount(post.viewsCount || 0)}</Typography>
			</Box>
		</Box>
	);
};
