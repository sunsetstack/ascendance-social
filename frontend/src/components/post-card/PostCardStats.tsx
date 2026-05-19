import { Box, Typography } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CommentIcon from "@mui/icons-material/Comment";
import VisibilityIcon from "@mui/icons-material/Visibility";
import RepeatIcon from "@mui/icons-material/Repeat";
import { IPost } from "../../types";
import { formatCount } from "./postCard.utils";

interface PostCardStatsProps {
	post: IPost;
	hasReposted: boolean;
	onRepostClick: (event: React.MouseEvent) => void;
}

export const PostCardStats: React.FC<PostCardStatsProps> = ({
	post,
	hasReposted,
	onRepostClick,
}) => {
	return (
		<Box
			sx={{
				display: "flex",
				justifyContent: "space-between",
				maxWidth: 520,
				mt: 1.5,
			}}
		>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.5,
					color: "text.secondary",
					"&:hover": { color: "#0ea5e9" },
				}}
			>
				<FavoriteIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.likes || 0)}</Typography>
			</Box>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.5,
					color: hasReposted ? "#22c55e" : "text.secondary",
					"&:hover": { color: "#22c55e" },
					cursor: "pointer",
				}}
				onClick={onRepostClick}
			>
				<RepeatIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.repostCount || 0)}</Typography>
			</Box>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.5,
					color: "text.secondary",
					"&:hover": { color: "#3b82f6" },
				}}
			>
				<CommentIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.commentsCount || 0)}</Typography>
			</Box>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.5,
					color: "text.secondary",
					"&:hover": { color: "#0ea5e9" },
				}}
			>
				<VisibilityIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.viewsCount || 0)}</Typography>
			</Box>
		</Box>
	);
};
