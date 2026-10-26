import { Avatar, Box, Typography } from "@mui/material";
import GroupsIcon from "@mui/icons-material/Groups";
import { Link as RouterLink } from "react-router-dom";
import { IPost } from "../../types";

interface PostCardCommunityBadgeProps {
	post: IPost;
	communityAvatarUrl: string | null;
}

export const PostCardCommunityBadge: React.FC<PostCardCommunityBadgeProps> = ({
	post,
	communityAvatarUrl,
}) => {
	const community = post.community;

	if (!community?.publicId || !community.name || !community.slug) {
		return null;
	}

	return (
		<Box
			component={RouterLink}
			to={`/communities/${community.slug}`}
			sx={{
				textDecoration: "none",
				"&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
				px: 2,
				pt: 1.5,
				pb: 0.5,
				display: "flex",
				alignItems: "center",
				gap: 0.75,
			}}
			onClick={(event) => {
				event.stopPropagation();
			}}
		>
			{community.avatar ? (
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
				{community.name}
			</Typography>
		</Box>
	);
};
