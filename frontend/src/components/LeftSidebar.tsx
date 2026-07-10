import React, { useState } from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import {
	Box,
	List,
	ListItem,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	Avatar,
	Typography,
	useTheme,
	alpha,
	Button,
	Badge,
	Menu,
	MenuItem,
	IconButton,
} from "@mui/material";
import {
	Home as HomeIcon,
	Person as PersonIcon,
	Add as AddIcon,
	CameraAlt as CameraAltIcon,
	Explore as ExploreIcon,
	Bookmark as BookmarkIcon,
	ChatBubbleOutline as ChatBubbleOutlineIcon,
	AdminPanelSettings as AdminPanelSettingsIcon,
	Notifications as NotificationsIcon,
	MoreHoriz as MoreHorizIcon,
	Language as LanguageIcon,
	Groups as GroupsIcon,
	Settings as SettingsIcon,
} from "@mui/icons-material";
import { useAuth } from "../hooks/context/useAuth";
import { useNotifications } from "../hooks/notifications/useNotification";
import { useTranslation } from "react-i18next";

const BASE_URL = "/api";

interface NavigationItem {
	label: string;
	icon: React.ReactNode;
	path?: string;
	onClick?: () => void;
}

interface LeftSidebarProps {
	onPostClick: () => void;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({ onPostClick }) => {
	const { t, i18n } = useTranslation();
	const { isLoggedIn, logout, user } = useAuth();
	const { notifications } = useNotifications();
	const location = useLocation();
	const navigate = useNavigate();
	const theme = useTheme();

	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
	const open = Boolean(anchorEl);

	const unreadCount = notifications.filter((n) => !n.isRead).length;

	const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
		setAnchorEl(event.currentTarget);
	};

	const handleClose = () => {
		setAnchorEl(null);
	};

	const toggleLanguage = (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const newLang = i18n.resolvedLanguage?.startsWith("bg") ? "en" : "bg";
		i18n.changeLanguage(newLang);
	};

	const handleLogout = () => {
		handleClose();
		logout();
		navigate("/");
	};

	// Handle undefined avatar safely
	const avatarUrl = user?.avatar || "";
	const fullAvatarUrl = avatarUrl.startsWith("http")
		? avatarUrl
		: avatarUrl.startsWith("/")
			? `${BASE_URL}${avatarUrl}`
			: avatarUrl
				? `${BASE_URL}/${avatarUrl}`
				: undefined;

	const isRouteActive = (targetPath?: string) => {
		if (!targetPath) return false;
		if (targetPath === "/") return location.pathname === "/";
		return location.pathname === targetPath || location.pathname.startsWith(`${targetPath}/`);
	};

	const isAdmin = user && "isAdmin" in user && user.isAdmin === true;

	const navigationItems: NavigationItem[] = [
		{
			label: t("nav.home"),
			icon: <HomeIcon sx={{ fontSize: 28 }} />,
			path: "/",
		},
		{
			label: t("nav.explore"),
			icon: <ExploreIcon sx={{ fontSize: 28 }} />,
			path: "/discover",
		},
		{
			label: t("nav.communities"),
			icon: <GroupsIcon sx={{ fontSize: 28 }} />,
			path: "/communities",
		},
		{
			label: t("nav.notifications"),
			icon: (
				<Badge
					badgeContent={unreadCount}
					color="primary"
					sx={{
						"& .MuiBadge-badge": {
							right: 2,
							top: 2,
						},
					}}
				>
					<NotificationsIcon sx={{ fontSize: 28 }} />
				</Badge>
			),
			path: "/notifications",
		},
		{
			label: t("nav.profile"),
			icon: user ? (
				<Avatar src={fullAvatarUrl} sx={{ width: 28, height: 28 }}>
					{user.username?.charAt(0).toUpperCase()}
				</Avatar>
			) : (
				<PersonIcon sx={{ fontSize: 28 }} />
			),
			path: user?.handle ? `/profile/${user.handle}` : "/profile",
		},
		{
			label: t("nav.favorites"),
			icon: <BookmarkIcon sx={{ fontSize: 28 }} />,
			path: "/favorites",
		},
		{
			label: t("nav.messages"),
			icon: <ChatBubbleOutlineIcon sx={{ fontSize: 28 }} />,
			path: "/messages",
		},
		{
			label: t("nav.settings") || "Settings",
			icon: <SettingsIcon sx={{ fontSize: 28 }} />,
			path: "/settings",
		},
	];

	if (isAdmin) {
		navigationItems.push({
			label: t("nav.admin"),
			icon: <AdminPanelSettingsIcon sx={{ fontSize: 28 }} />,
			path: "/admin",
		});
	}

	return (
		<Box
			sx={{
				height: "100%",
				display: "flex",
				flexDirection: "column",
				px: { md: 1.5, lg: 2 },
				py: 1,
			}}
		>
			{/* Logo Section */}
			<Box
				component={RouterLink}
				to="/"
				sx={{
					py: 1.5,
					px: { md: 0, lg: 1 },
					display: "flex",
					alignItems: "center",
					justifyContent: { md: "center", lg: "flex-start" },
					gap: 1.5,
					textDecoration: "none",
				}}
			>
				<Box
					sx={{
						width: 44,
						height: 44,
						borderRadius: 3,
						display: "grid",
						placeItems: "center",
						background: "linear-gradient(145deg, #38bdf8 0%, #8b5cf6 100%)",
						boxShadow: "0 10px 30px rgba(56, 189, 248, 0.18)",
						transition: "transform 0.2s ease, box-shadow 0.2s ease",
						"&:hover": {
							transform: "translateY(-1px)",
							boxShadow: "0 12px 34px rgba(139, 92, 246, 0.24)",
						},
					}}
				>
					<CameraAltIcon sx={{ fontSize: 25, color: "#ffffff" }} />
				</Box>
				<Box sx={{ display: { md: "none", lg: "block" }, minWidth: 0 }}>
					<Typography
						variant="h6"
						sx={{ fontWeight: 800, lineHeight: 1.1, letterSpacing: "-0.03em" }}
					>
						Ascendance
					</Typography>
					<Typography variant="caption" color="text.secondary">
						{t("marketing.subtitle")}
					</Typography>
				</Box>
			</Box>

			{/* Navigation Section */}
			<Box sx={{ flex: 1 }}>
				{isLoggedIn ? (
					<List>
						{navigationItems.map((item) => (
							<ListItem key={item.label} disablePadding sx={{ mb: 1 }}>
								<ListItemButton
									component={item.path ? RouterLink : "button"}
									to={item.path}
									onClick={item.onClick}
									sx={{
										borderRadius: 9999,
										py: 1.5,
										px: 2,
										"&:hover": {
											backgroundColor: alpha(theme.palette.text.primary, 0.1),
										},
									}}
								>
									<ListItemIcon
										sx={{
											color: isRouteActive(item.path) ? theme.palette.primary.main : theme.palette.text.primary,
											minWidth: 0,
											mr: 2,
										}}
									>
										{item.icon}
									</ListItemIcon>
									<ListItemText
										primary={item.label}
										sx={{
											display: { xs: "none", lg: "block" },
											"& .MuiListItemText-primary": {
												fontWeight: isRouteActive(item.path) ? 700 : 400,
												fontSize: "1.25rem",
												color: theme.palette.text.primary,
											},
										}}
									/>
								</ListItemButton>
							</ListItem>
						))}

						{/* Post Button */}
						<ListItem sx={{ px: 0, mt: 2 }}>
							<Button
								onClick={onPostClick}
								variant="contained"
								fullWidth
								sx={{
									borderRadius: 9999,
									py: 1.5,
									fontSize: "1.1rem",
									fontWeight: 700,
									textTransform: "none",
									boxShadow: "none",
									border: `1px solid ${theme.palette.primary.main}`,
									background: "transparent",
									display: { xs: "none", lg: "flex" },
								}}
							>
								{t("nav.post")}
							</Button>
							<Button
								onClick={onPostClick}
								variant="contained"
								sx={{
									borderRadius: "50%",
									minWidth: 50,
									width: 50,
									height: 50,
									p: 0,
									boxShadow: "none",
									display: { xs: "flex", lg: "none" },
									justifyContent: "center",
									alignItems: "center",
								}}
							>
								<AddIcon />
							</Button>
						</ListItem>
					</List>
				) : (
					<Box
						sx={{
							p: 2.5,
							mt: 3,
							textAlign: "left",
							display: { md: "none", lg: "flex" },
							flexDirection: "column",
							gap: 1.5,
							border: `1px solid ${theme.palette.divider}`,
							borderRadius: 4,
							background: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.11)}, ${alpha(theme.palette.secondary.main, 0.07)} 65%, transparent)`,
						}}
					>
						<Typography
							variant="overline"
							sx={{ color: "primary.light", fontWeight: 800, letterSpacing: "0.14em", lineHeight: 1.2 }}
						>
							{t("marketing.welcome_label")}
						</Typography>
						<Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6, mb: 0.5 }}>
							{t("auth.sign_in_prompt")}
						</Typography>
						<Button
							component={RouterLink}
							to="/register"
							variant="contained"
							fullWidth
							sx={{ py: 1.15, background: "linear-gradient(90deg, #0ea5e9, #7c3aed)" }}
						>
							{t("auth.join")}
						</Button>
						<Button component={RouterLink} to="/login" variant="text" fullWidth sx={{ color: "text.primary" }}>
							{t("auth.login")}
						</Button>
					</Box>
				)}
			</Box>

			{isLoggedIn && user && (
				<Box sx={{ py: 3 }}>
					<ListItemButton
						component={RouterLink}
						to={`/profile/${user.handle}`}
						sx={{
							borderRadius: 9999,
							p: 1.5,
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							"&:hover": {
								backgroundColor: alpha(theme.palette.text.primary, 0.1),
							},
						}}
					>
						<Box sx={{ display: "flex", alignItems: "center", minWidth: 0 }}>
							<ListItemIcon sx={{ minWidth: 0, mr: { xs: 0, lg: 1.5 } }}>
								<Avatar src={fullAvatarUrl} sx={{ width: 40, height: 40 }}>
									{user.username?.charAt(0).toUpperCase()}
								</Avatar>
							</ListItemIcon>
							<Box
								sx={{
									display: { xs: "none", lg: "block" },
									overflow: "hidden",
								}}
							>
								<Typography variant="subtitle1" fontWeight={700} noWrap>
									{user.username}
								</Typography>
								<Typography variant="body2" color="text.secondary" noWrap>
									@{user.handle}
								</Typography>
							</Box>
						</Box>

						<Box sx={{ display: { xs: "none", lg: "block" } }}>
							<IconButton
								size="small"
								onClick={handleMenuClick}
								sx={{
									color: theme.palette.text.primary,
									"&:hover": {
										backgroundColor: alpha(theme.palette.primary.main, 0.1),
									},
								}}
							>
								<MoreHorizIcon />
							</IconButton>
						</Box>
					</ListItemButton>

					<Menu
						anchorEl={anchorEl}
						open={open}
						onClose={handleClose}
						PaperProps={{
							sx: {
								borderRadius: 3,
								boxShadow: theme.shadows[3],
								minWidth: 180,
							},
						}}
						transformOrigin={{ horizontal: "center", vertical: "bottom" }}
						anchorOrigin={{ horizontal: "center", vertical: "top" }}
					>
						<MenuItem onClick={toggleLanguage} sx={{ py: 1.5, fontWeight: 700, gap: 1.5 }}>
							<LanguageIcon fontSize="small" />
							{i18n.resolvedLanguage?.startsWith("bg") ? "🇧🇬 BG" : "🇺🇸 EN"}
						</MenuItem>
						<MenuItem onClick={handleLogout} sx={{ py: 1.5, fontWeight: 700 }}>
							{t("auth.logout_user", { username: user.username })}
						</MenuItem>
					</Menu>
				</Box>
			)}
		</Box>
	);
};

export default LeftSidebar;
