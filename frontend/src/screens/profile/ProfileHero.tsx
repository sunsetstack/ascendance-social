import {
	Avatar,
	Box,
	Button,
	IconButton,
	Tooltip,
	Typography,
	alpha,
	useTheme,
} from "@mui/material";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import GavelIcon from "@mui/icons-material/Gavel";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PublicUserDTO } from "../../types";

interface ProfileHeroProps {
	profileData: PublicUserDTO;
	fullAvatarUrl?: string;
	fullCoverUrl?: string;
	isProfileOwner: boolean;
	isLoggedIn: boolean;
	isFollowing?: boolean;
	isCheckingFollow: boolean;
	followPending: boolean;
	postCount: number;
	viewerIsAdmin: boolean;
	onBack: () => void;
	onOpenCoverModal: () => void;
	onOpenAvatarModal: () => void;
	onOpenEditProfile: () => void;
	onFollow: () => void;
	onMessage: () => void;
	onOpenAdminDetails: () => void;
	onBanUser: () => void;
	onDeleteUser: () => void;
}

export const ProfileHero: React.FC<ProfileHeroProps> = ({
	profileData,
	fullAvatarUrl,
	fullCoverUrl,
	isProfileOwner,
	isLoggedIn,
	isFollowing,
	isCheckingFollow,
	followPending,
	postCount,
	viewerIsAdmin,
	onBack,
	onOpenCoverModal,
	onOpenAvatarModal,
	onOpenEditProfile,
	onFollow,
	onMessage,
	onOpenAdminDetails,
	onBanUser,
	onDeleteUser,
}) => {
	const theme = useTheme();
	const navigate = useNavigate();
	const { t } = useTranslation();

	return (
		<>
			<Box
				sx={{
					position: "sticky",
					top: 0,
					zIndex: 1000,
					bgcolor: "rgba(0, 0, 0, 0.65)",
					backdropFilter: "blur(12px)",
					borderBottom: `1px solid ${theme.palette.divider}`,
					px: 2,
					py: 0.5,
					display: "flex",
					alignItems: "center",
					gap: 3,
				}}
			>
				<IconButton onClick={onBack} size="small">
					<ArrowBackIcon />
				</IconButton>
				<Box>
					<Typography variant="h6" sx={{ lineHeight: 1.2 }}>
						{profileData.username}
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{postCount} posts
					</Typography>
				</Box>
			</Box>

			<Box
				sx={{
					position: "relative",
					height: { xs: 150, sm: 200 },
					bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.200",
					backgroundSize: "cover",
					backgroundPosition: "center",
					backgroundImage: fullCoverUrl ? `url(${fullCoverUrl})` : "none",
				}}
			>
				{isProfileOwner && (
					<IconButton
						size="small"
						onClick={onOpenCoverModal}
						sx={{
							position: "absolute",
							bottom: 16,
							right: 16,
							bgcolor: alpha(theme.palette.common.black, 0.5),
							color: theme.palette.common.white,
							"&:hover": {
								bgcolor: alpha(theme.palette.common.black, 0.7),
							},
						}}
					>
						<CameraAltIcon fontSize="small" />
					</IconButton>
				)}
			</Box>

			<Box sx={{ px: 2, pb: 2 }}>
				<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
					<Box sx={{ mt: "-15%" }}>
						<Box sx={{ position: "relative", display: "inline-block" }}>
							<Avatar
								src={fullAvatarUrl}
								alt={`${profileData.username}'s avatar`}
								sx={{
									width: { xs: 80, sm: 134 },
									height: { xs: 80, sm: 134 },
									border: `4px solid ${theme.palette.background.default}`,
								}}
							/>
							{isProfileOwner && (
								<IconButton
									size="small"
									onClick={onOpenAvatarModal}
									sx={{
										position: "absolute",
										bottom: 0,
										right: 0,
										bgcolor: alpha(theme.palette.common.black, 0.5),
										color: theme.palette.common.white,
										"&:hover": { bgcolor: alpha(theme.palette.common.black, 0.7) },
									}}
								>
									<CameraAltIcon fontSize="small" />
								</IconButton>
							)}
						</Box>
					</Box>

					<Box sx={{ mt: 1.5 }}>
						{isProfileOwner ? (
							<Button
								variant="outlined"
								onClick={onOpenEditProfile}
								sx={{
									borderRadius: 9999,
									textTransform: "none",
									fontWeight: 700,
									borderColor: theme.palette.divider,
									color: theme.palette.text.primary,
									"&:hover": {
										bgcolor: alpha(theme.palette.text.primary, 0.1),
										borderColor: theme.palette.divider,
									},
								}}
							>
								{t("profile.edit_profile")}
							</Button>
						) : isLoggedIn ? (
							<Box sx={{ display: "flex", gap: 1 }}>
								<Tooltip title={t("profile.message")}>
									<IconButton
										onClick={onMessage}
										sx={{
											border: `1px solid ${theme.palette.divider}`,
											color: theme.palette.text.primary,
										}}
									>
										<MailOutlineIcon />
									</IconButton>
								</Tooltip>
								<Button
									variant={isFollowing ? "outlined" : "contained"}
									onClick={onFollow}
									disabled={isCheckingFollow || followPending}
									sx={{
										borderRadius: 9999,
										textTransform: "none",
										fontWeight: 700,
										minWidth: 100,
										bgcolor: isFollowing ? "transparent" : "common.white",
										color: isFollowing ? "text.primary" : "common.black",
										borderColor: isFollowing ? "divider" : "transparent",
										"&:hover": {
											bgcolor: isFollowing ? "rgba(244, 33, 46, 0.1)" : alpha(theme.palette.common.white, 0.9),
											color: isFollowing ? "error.main" : "common.black",
											borderColor: isFollowing ? "error.main" : "transparent",
										},
									}}
								>
									{isFollowing ? t("profile.unfollow") : t("profile.follow")}
								</Button>
								{viewerIsAdmin && !isProfileOwner && (
									<>
										<Tooltip title="Account Details (Admin)">
											<IconButton
												onClick={onOpenAdminDetails}
												sx={{
													border: `1px solid ${theme.palette.divider}`,
													color: "info.main",
												}}
											>
												<InfoOutlinedIcon />
											</IconButton>
										</Tooltip>
										<Tooltip title="Ban User (Admin)">
											<IconButton
												onClick={onBanUser}
												sx={{
													border: `1px solid ${theme.palette.divider}`,
													color: "warning.main",
												}}
											>
												<GavelIcon />
											</IconButton>
										</Tooltip>
										<Tooltip title="Delete User (Admin)">
											<IconButton
												onClick={onDeleteUser}
												sx={{
													border: `1px solid ${theme.palette.divider}`,
													color: "error.main",
												}}
											>
												<DeleteForeverIcon />
											</IconButton>
										</Tooltip>
									</>
								)}
							</Box>
						) : (
							<Button
								variant="contained"
								onClick={onFollow}
								sx={{
									borderRadius: 9999,
									bgcolor: "common.white",
									color: "common.black",
									fontWeight: 700,
									"&:hover": { bgcolor: alpha(theme.palette.common.white, 0.9) },
								}}
							>
								{t("profile.follow")}
							</Button>
						)}
					</Box>
				</Box>

				<Box sx={{ mt: 1 }}>
					<Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
						{profileData.username}
					</Typography>
					<Typography variant="body2" color="text.secondary">
						@{profileData.handle}
					</Typography>
				</Box>

				{profileData.bio && (
					<Typography variant="body1" sx={{ mt: 1.5, whiteSpace: "pre-wrap" }}>
						{profileData.bio}
					</Typography>
				)}

				<Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 1.5, color: "text.secondary" }}>
					<Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
						<CalendarMonthIcon fontSize="small" />
						<Typography variant="body2">
							{t("profile.joined", {
								date: profileData.createdAt ? new Date(profileData.createdAt).toLocaleDateString() : "Unknown",
							})}
						</Typography>
					</Box>
				</Box>

				<Box sx={{ display: "flex", gap: 2.5, mt: 1.5 }}>
					<Box
						sx={{ display: "flex", gap: 0.5, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
						onClick={() => navigate(`/profile/${profileData.handle}/follow?tab=following`)}
					>
						<Typography variant="body2" fontWeight={700} color="text.primary">
							{profileData.followingCount || 0}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{t("profile.following")}
						</Typography>
					</Box>
					<Box
						sx={{ display: "flex", gap: 0.5, cursor: "pointer", "&:hover": { textDecoration: "underline" } }}
						onClick={() => navigate(`/profile/${profileData.handle}/follow?tab=followers`)}
					>
						<Typography variant="body2" fontWeight={700} color="text.primary">
							{profileData.followerCount || 0}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							{t("profile.followers")}
						</Typography>
					</Box>
				</Box>
			</Box>
		</>
	);
};
