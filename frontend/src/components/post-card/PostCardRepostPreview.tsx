import { Avatar, Box, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RichText from "../RichText";
import { IPost } from "../../types";
import { formatCount } from "./postCard.utils";

interface PostCardRepostPreviewProps {
	post: IPost;
	repostAvatarUrl: string | null;
	repostImageUrl: string | null;
	repostImageSrcSet?: string;
}

export const PostCardRepostPreview: React.FC<PostCardRepostPreviewProps> = ({
	post,
	repostAvatarUrl,
	repostImageUrl,
	repostImageSrcSet,
}) => {
	const navigate = useNavigate();
	const { t } = useTranslation();

	if (post.type !== "repost" || !post.repostOf) {
		return null;
	}

	return (
		<Box
			sx={{
				mt: 1.5,
				border: "1px solid",
				borderColor: "divider",
				borderRadius: 3,
				p: 1.5,
				cursor: "pointer",
				"&:hover": {
					bgcolor: "rgba(255, 255, 255, 0.03)",
				},
			}}
			onClick={(event) => {
				event.stopPropagation();
				if (post.repostOf?.publicId) {
					navigate(`/posts/${post.repostOf.publicId}`);
				}
			}}
		>
			<Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
				<Avatar sx={{ width: 24, height: 24 }} src={repostAvatarUrl ?? undefined}>
					{post.repostOf.user.username.charAt(0).toUpperCase()}
				</Avatar>
				<Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
					{post.repostOf.user.username}
				</Typography>
			</Box>

			{post.repostOf.body && (
				<Typography variant="body2" sx={{ mb: post.repostOf.image ? 1.5 : 0 }}>
					<RichText text={post.repostOf.body} />
				</Typography>
			)}

			{post.repostOf.image && repostImageUrl && (
				<Box
					sx={{
						borderRadius: 2,
						overflow: "hidden",
						width: "100%",
						maxHeight: "400px",
						display: "flex",
						justifyContent: "center",
						bgcolor: "black",
					}}
				>
					<img
						src={repostImageUrl}
						srcSet={repostImageSrcSet}
						sizes="(max-width: 600px) 100vw, 511px"
						alt={t("post.reposted_content")}
						loading="lazy"
						decoding="async"
						style={{
							width: "100%",
							height: "auto",
							maxHeight: "400px",
							objectFit: "cover",
							display: "block",
						}}
					/>
				</Box>
			)}

			<Box sx={{ display: "flex", gap: 2, mt: 1, color: "text.secondary" }}>
				<Typography variant="caption">
					{formatCount(post.repostOf.likes || 0)} {t("post.likes")}
				</Typography>
				<Typography variant="caption">
					{formatCount(post.repostOf.repostCount || 0)} {t("post.reposts")}
				</Typography>
				<Typography variant="caption">
					{formatCount(post.repostOf.commentsCount || 0)} {t("post.comments")}
				</Typography>
			</Box>
		</Box>
	);
};
