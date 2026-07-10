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
				mt: 1.75,
				mx: -0.75,
			}}
		>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: "text.secondary",
					"&:hover": { color: "#f43f5e", bgcolor: "rgba(244, 63, 94, 0.1)" },
				}}
			>
				<FavoriteIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.likes || 0)}</Typography>
			</Box>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: hasReposted ? "#22c55e" : "text.secondary",
					"&:hover": { color: "#22c55e", bgcolor: "rgba(34, 197, 94, 0.1)" },
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
					gap: 0.75,
					minWidth: 48,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: "text.secondary",
					"&:hover": { color: "#38bdf8", bgcolor: "rgba(56, 189, 248, 0.1)" },
				}}
			>
				<CommentIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.commentsCount || 0)}</Typography>
			</Box>
			<Box
				sx={{
					display: "flex",
					alignItems: "center",
					gap: 0.75,
					minWidth: 48,
					px: 0.75,
					py: 0.5,
					borderRadius: 999,
					color: "text.secondary",
					"&:hover": { color: "#a78bfa", bgcolor: "rgba(139, 92, 246, 0.1)" },
				}}
			>
				<VisibilityIcon fontSize="small" sx={{ fontSize: 18 }} />
				<Typography variant="caption">{formatCount(post.viewsCount || 0)}</Typography>
			</Box>
		</Box>
	);
};
