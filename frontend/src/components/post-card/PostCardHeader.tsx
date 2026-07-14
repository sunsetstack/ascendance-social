import React from "react";
import {
	Avatar,
	Box,
	Chip,
	IconButton,
	Tooltip,
	Typography,
} from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import DeleteIcon from "@mui/icons-material/Delete";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IPost } from "../../types";

interface PostCardHeaderProps {
	post: IPost;
	avatarUrl: string | null;
	hasCommunity: boolean;
	isAdmin: boolean;
	onDeleteClick: (event: React.MouseEvent) => void;
	media?: React.ReactNode;
	footer?: React.ReactNode;
	children: React.ReactNode;
}

export const PostCardHeader: React.FC<PostCardHeaderProps> = ({
	post,
	avatarUrl,
	hasCommunity,
	isAdmin,
	onDeleteClick,
	media,
	footer,
	children,
}) => {
	const { t } = useTranslation();
	const navigate = useNavigate();

	return (
		<Box
			sx={{
				px: { xs: 2, sm: 2.25 },
				pt: hasCommunity ? 0.5 : 2,
				pb: 1.25,
			}}
		>
			<Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
				<Avatar
					sx={{ width: 42, height: 42, cursor: "pointer", border: "1px solid", borderColor: "divider" }}
					onClick={(event) => {
						event.stopPropagation();
						navigate(`/profile/${post.user?.handle || post.user?.publicId}`);
					}}
				>
					{post.user?.avatar ? (
						<img
							src={avatarUrl ?? undefined}
							alt={post.user.username}
							loading="lazy"
							decoding="async"
							width={40}
							height={40}
							style={{ width: "100%", height: "100%", objectFit: "cover" }}
						/>
					) : (
						<span>{post.user?.username?.charAt(0).toUpperCase()}</span>
					)}
				</Avatar>

				<Box sx={{ flex: 1, minWidth: 0 }}>
					{post.type === "repost" && post.repostOf?.user && (
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
							{t("post.reposted_from", {
								username: post.repostOf.user.username,
							})}
						</Typography>
					)}
					<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75, minWidth: 0 }}>
						<Typography
							variant="body1"
							sx={{
								fontWeight: 700,
								color: "text.primary",
								"&:hover": { textDecoration: "underline" },
							}}
							onClick={(event) => {
								event.stopPropagation();
								navigate(`/profile/${post.user?.handle || post.user?.publicId}`);
							}}
						>
							{post.user?.username || t("post.unknown_user")}
						</Typography>
						{post.user?.handle && (
							<Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
								@{post.user.handle}
							</Typography>
						)}
						{post.authorCommunityRole === "admin" && (
							<Chip
								icon={<AdminPanelSettingsIcon sx={{ fontSize: 14 }} />}
								label="Admin"
								size="small"
								color="primary"
								variant="outlined"
								sx={{
									height: 18,
									fontSize: "0.65rem",
									"& .MuiChip-icon": { width: 14, height: 14 },
								}}
							/>
						)}
						{post.authorCommunityRole === "moderator" && (
							<Chip
								label="Mod"
								size="small"
								color="secondary"
								variant="outlined"
								sx={{ height: 18, fontSize: "0.65rem" }}
							/>
						)}
						<Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
							· {new Date(post.createdAt).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
							})}
						</Typography>

						{isAdmin && (
							<Tooltip
								title={t("admin.delete_post", {
									defaultValue: "Delete Post (Admin)",
								})}
							>
								<IconButton
									size="small"
									onClick={onDeleteClick}
									sx={{
										ml: "auto",
										color: "error.main",
										padding: 0.5,
										"&:hover": { bgcolor: "rgba(244, 33, 46, 0.1)" },
									}}
								>
									<DeleteIcon sx={{ fontSize: 18 }} />
								</IconButton>
								</Tooltip>
							)}
					</Box>
					{children}
				</Box>
			</Box>

			{media && (
				<Box sx={{ width: "100%", display: "flex", justifyContent: "center" }}>
					{media}
				</Box>
			)}

			{footer && (
				<Box sx={{ ml: { xs: 5.5, sm: 5.75 }, minWidth: 0 }}>
					{footer}
				</Box>
			)}
		</Box>
	);
};
