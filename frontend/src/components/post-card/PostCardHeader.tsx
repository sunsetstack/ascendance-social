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
import EditIcon from "@mui/icons-material/Edit";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { IPost } from "../../types";

interface PostCardHeaderProps {
	post: IPost;
	avatarUrl: string | null;
	hasCommunity: boolean;
	isAdmin: boolean;
	onDeleteClick: (event: React.MouseEvent) => void;
	onEditClick?: (event: React.MouseEvent) => void;
	onOpen?: (postPublicId: string) => void;
	media?: React.ReactNode;
	footer?: React.ReactNode;
	context?: React.ReactNode;
	children: React.ReactNode;
}

export const PostCardHeader: React.FC<PostCardHeaderProps> = ({
	post,
	avatarUrl,
	hasCommunity,
	isAdmin,
	onDeleteClick,
	onEditClick,
	onOpen,
	media,
	footer,
	context,
	children,
}) => {
	const { t } = useTranslation();
	const profileUrl = `/profile/${post.user?.handle || post.user?.publicId}`;

	return (
		<Box
			sx={{
				px: 2,
				pt: hasCommunity ? 1 : 2,
				pb: 1.5,
			}}
		>
			<Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
				<Avatar
					component={RouterLink}
					to={profileUrl}
					aria-label={t("post.open_profile", { username: post.user?.username || t("post.unknown_user") })}
					sx={{ width: 40, height: 40, flexShrink: 0, cursor: "pointer", bgcolor: "#26364a", color: "#d7e6f5" }}
					onClick={(event) => {
						event.stopPropagation();
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
					{context}
					{post.type === "repost" && post.repostOf?.user && (
						<Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
							{t("post.reposted_from", {
								username: post.repostOf.user.username,
							})}
						</Typography>
					)}
					<Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75, minWidth: 0 }}>
						<Typography
							component={RouterLink}
							to={profileUrl}
							variant="body1"
							noWrap
							sx={{
								minWidth: 0,
								maxWidth: "60%",
								fontWeight: 700,
								color: "text.primary",
								textDecoration: "none",
								"&:hover": { textDecoration: "underline" },
							}}
							onClick={(event) => {
								event.stopPropagation();
							}}
						>
							{post.user?.username || t("post.unknown_user")}
						</Typography>
						{post.user?.handle && (
							<Typography variant="body2" color="text.secondary" noWrap sx={{ minWidth: 0, flexShrink: 2 }}>
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
						<Typography
							component={RouterLink}
							to={`/posts/${post.publicId}`}
							aria-label={t("profile.view_post")}
							onClick={(event) => {
								event.stopPropagation();
								onOpen?.(post.publicId);
							}}
							variant="body2"
							color="text.secondary"
							sx={{ flexShrink: 0, whiteSpace: "nowrap", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
						>
							· {new Date(post.createdAt).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
							})}
						</Typography>

						{onEditClick && <Tooltip title={t("composer.edit_post")}><IconButton size="small" aria-label={t("composer.edit_post")} onClick={onEditClick} sx={{ ml: "auto", p: 0.5 }}><EditIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>}
						{isAdmin && (
							<Tooltip
								title={t("admin.delete_post", {
									defaultValue: "Delete Post (Admin)",
								})}
							>
								<IconButton
									size="small"
									onClick={onDeleteClick}
									aria-label="Delete post"
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
					{post.editedAt && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>{t("composer.edited")}</Typography>}
					{children}
					{media}
					{footer}
				</Box>
			</Box>
		</Box>
	);
};
