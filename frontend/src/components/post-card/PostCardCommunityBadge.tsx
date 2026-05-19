import { Avatar, Box, Typography } from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import { useNavigate } from "react-router-dom";
import { IPost } from "../../types";

interface PostCardCommunityBadgeProps {
	post: IPost;
	communityAvatarUrl: string | null;
}

export const PostCardCommunityBadge: React.FC<PostCardCommunityBadgeProps> = ({
	post,
	communityAvatarUrl,
}) => {
	const navigate = useNavigate();

	if (!post.community) {
		return null;
	}

	return (
		<Box
			sx={{
				px: 2,
				pt: 1.5,
				pb: 0.5,
				display: "flex",
				alignItems: "center",
				gap: 0.75,
			}}
			onClick={(event) => {
				event.stopPropagation();
				if (post.community?.slug) {
					navigate(`/communities/${post.community.slug}`);
				}
			}}
		>
			{post.community.avatar ? (
				<Avatar src={communityAvatarUrl ?? undefined} sx={{ width: 16, height: 16 }} />
			) : (
				<GroupsIcon sx={{ fontSize: 16, color: "primary.main" }} />
			)}
			<Typography
				variant="caption"
				sx={{
					color: "primary.main",
					fontWeight: 600,
					cursor: "pointer",
					"&:hover": { textDecoration: "underline" },
				}}
			>
				{post.community.name}
			</Typography>
		</Box>
	);
};
