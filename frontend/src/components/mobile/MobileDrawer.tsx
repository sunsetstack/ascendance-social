import React from "react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { Box, Avatar, Typography, Badge, Collapse, alpha } from "@mui/material";
import {
	Home as HomeIcon,
	Explore as ExploreIcon,
	Groups as GroupsIcon,
	ChatBubbleOutline as ChatBubbleOutlineIcon,
	Notifications as NotificationsIcon,
	Person as PersonIcon,
	Bookmark as BookmarkIcon,
	AdminPanelSettings as AdminPanelSettingsIcon,
	Settings as SettingsIcon,
	Logout as LogoutIcon,
	ExpandMore as ExpandMoreIcon,
	ExpandLess as ExpandLessIcon,
	TrendingUp as TrendingUpIcon,
	NewReleases as NewReleasesIcon,
	Whatshot as WhatshotIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useAuth } from "../../hooks/context/useAuth";
import { useNotifications } from "../../hooks/notifications/useNotification";
import { useTranslation } from "react-i18next";

const BASE_URL = "/api";
const DRAWER_WIDTH = 280;

interface MobileDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	drawerRef: React.RefObject<HTMLDivElement>;
	backdropRef: React.RefObject<HTMLDivElement>;
	dragOffset: number;
	isDragging: boolean;
}

interface NavItem {
	label: string;
	icon: React.ReactNode;
	path?: string;
	onClick?: () => void;
	badge?: number;
	children?: NavItem[];
}

const MobileDrawer: React.FC<MobileDrawerProps> = ({
	isOpen,
	onClose,
	drawerRef,
	backdropRef,
	dragOffset,
	isDragging,
}) => {
	const { t } = useTranslation();
	const theme = useTheme();
	const location = useLocation();
	const navigate = useNavigate();
	const { isLoggedIn, logout, user } = useAuth();
	const { notifications } = useNotifications();

	const [exploreExpanded, setExploreExpanded] = React.useState(false);

	const unreadCount = notifications.filter((n) => !n.isRead).length;

	const isAdmin = user && "isAdmin" in user && user.isAdmin === true;

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

	const handleNavClick = (path?: string, onClick?: () => void) => {
		if (onClick) {
			onClick();
		} else if (path) {
			navigate(path);
			onClose();
		}
	};

	const handleLogout = () => {
		logout();
		navigate("/");
		onClose();
	};

	// calculate transform based on open state and drag offset
	const getDrawerTransform = () => {
		if (isDragging) {
			if (isOpen) {
				// dragging to close: offset is negative
				return `translateX(${dragOffset}px)`;
			} else {
				// dragging to open: offset is positive, start from -DRAWER_WIDTH
				return `translateX(${-DRAWER_WIDTH + dragOffset}px)`;
			}
		}
		return isOpen ? "translateX(0)" : `translateX(-${DRAWER_WIDTH}px)`;
	};

	const getBackdropOpacity = () => {
		if (isDragging) {
			if (isOpen) {
				// closing: opacity decreases as offset becomes more negative
				return Math.max(0, 0.5 + (dragOffset / DRAWER_WIDTH) * 0.5);
			} else {
				// opening: opacity increases as offset increases
				return Math.min(0.5, (dragOffset / DRAWER_WIDTH) * 0.5);
			}
		}
		return isOpen ? 0.5 : 0;
	};

	// navigation items ordered by thumb zone (bottom = frequent, top = dangerous)
	const publicNavItems: NavItem[] = [
		{
			label: t("nav.home"),
			icon: <HomeIcon />,
			path: "/",
		},
		{
			label: t("nav.explore"),
			icon: <ExploreIcon />,
			onClick: () => setExploreExpanded(!exploreExpanded),
			children: [
				{ label: "Trending", icon: <TrendingUpIcon />, path: "/discover?feed=trending" },
				{ label: "Latest", icon: <NewReleasesIcon />, path: "/discover?feed=latest" },
				...(isLoggedIn
					? [{ label: "For You", icon: <WhatshotIcon />, path: "/discover?feed=foryou" }]
					: []),
			],
		},
		{
			label: t("nav.communities"),
			icon: <GroupsIcon />,
			path: "/communities",
		},
	];

	const authenticatedNavItems: NavItem[] = [
		{
			label: t("nav.messages"),
			icon: <ChatBubbleOutlineIcon />,
			path: "/messages",
		},
		{
			label: t("nav.notifications"),
			icon: <NotificationsIcon />,
			path: "/notifications",
			badge: unreadCount,
		},
	];

	const middleNavItems: NavItem[] = [
		{
			label: t("nav.profile"),
			icon: user ? (
				<Avatar src={fullAvatarUrl} sx={{ width: 24, height: 24 }}>
					{user.username?.charAt(0).toUpperCase()}
				</Avatar>
			) : (
				<PersonIcon />
			),
			path: user?.handle ? `/profile/${user.handle}` : "/profile",
		},
		{
			label: t("nav.favorites"),
			icon: <BookmarkIcon />,
			path: "/favorites",
		},
	];

	if (isAdmin) {
		middleNavItems.push({
			label: t("nav.admin"),
			icon: <AdminPanelSettingsIcon />,
			path: "/admin",
		});
	}

	const topNavItems: NavItem[] = [
		{
			label: t("nav.settings") || "Settings",
			icon: <SettingsIcon />,
			path: "/settings",
		},
		{
			label: t("auth.logout") || "Logout",
			icon: <LogoutIcon />,
			onClick: handleLogout,
		},
	];

	const renderNavItem = (item: NavItem, index: number) => {
		const isActive = isRouteActive(item.path);
		const hasChildren = item.children && item.children.length > 0;
		const isExplore = item.label === t("nav.explore");

		return (
			<React.Fragment key={item.label + index}>
				<Box
					onClick={() => (hasChildren ? item.onClick?.() : handleNavClick(item.path, item.onClick))}
					sx={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						px: 2,
						py: 1.75,
						cursor: "pointer",
						bgcolor: isActive ? alpha(theme.palette.primary.main, 0.1) : "transparent",
						borderRadius: 2,
						mx: 1,
						mb: 0.5,
						minHeight: 48,
						"&:active": {
							bgcolor: alpha(theme.palette.primary.main, 0.15),
						},
					}}
				>
					<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
						<Box
							sx={{
								color: isActive ? theme.palette.primary.main : theme.palette.text.primary,
								display: "flex",
								alignItems: "center",
							}}
						>
							{item.badge ? (
								<Badge badgeContent={item.badge} color="primary" max={99}>
									{item.icon}
								</Badge>
							) : (
								item.icon
							)}
						</Box>
						<Typography
							variant="body1"
							sx={{
								fontWeight: isActive ? 700 : 500,
								color: isActive ? theme.palette.primary.main : theme.palette.text.primary,
							}}
						>
							{item.label}
						</Typography>
					</Box>
					{hasChildren && (isExplore && exploreExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />)}
				</Box>

				{/* sub-items for explore */}
				{hasChildren && isExplore && (
					<Collapse in={exploreExpanded} timeout="auto" unmountOnExit>
						<Box sx={{ pl: 2 }}>
							{item.children?.map((child, childIndex) => (
								<Box
									key={child.label + childIndex}
									onClick={() => handleNavClick(child.path)}
									sx={{
										display: "flex",
										alignItems: "center",
										gap: 2,
										px: 2,
										py: 1.25,
										cursor: "pointer",
										borderRadius: 2,
										mx: 1,
										mb: 0.25,
										minHeight: 40,
										"&:active": {
											bgcolor: alpha(theme.palette.primary.main, 0.1),
										},
									}}
								>
									<Box sx={{ color: theme.palette.text.secondary, display: "flex", alignItems: "center" }}>
										{child.icon}
									</Box>
									<Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
										{child.label}
									</Typography>
								</Box>
							))}
						</Box>
					</Collapse>
				)}
			</React.Fragment>
		);
	};

	const renderSection = (items: NavItem[], divider: boolean = true) => (
		<Box sx={{ py: 1, ...(divider && { borderBottom: `1px solid ${theme.palette.divider}` }) }}>
			{items.map(renderNavItem)}
		</Box>
	);

	return (
		<>
			{/* backdrop */}
			<Box
				ref={backdropRef}
				sx={{
					position: "fixed",
					inset: 0,
					bgcolor: "black",
					opacity: getBackdropOpacity(),
					zIndex: 1200,
					pointerEvents: isOpen || isDragging ? "auto" : "none",
					transition: isDragging ? "none" : "opacity 0.3s ease",
					willChange: "opacity",
				}}
			/>

			{/* drawer panel */}
			<Box
				ref={drawerRef}
				data-testid="mobile-drawer"
				sx={{
					position: "fixed",
					top: 0,
					left: 0,
					bottom: 0,
					width: DRAWER_WIDTH,
					bgcolor: theme.palette.background.default,
					borderRight: `1px solid ${theme.palette.divider}`,
					zIndex: 1300,
					transform: getDrawerTransform(),
					transition: isDragging ? "none" : "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
					willChange: "transform",
					display: "flex",
					flexDirection: "column",
					overflowY: "auto",
					overflowX: "hidden",
					// safe area padding
					paddingTop: "env(safe-area-inset-top)",
					paddingBottom: "env(safe-area-inset-bottom)",
					paddingLeft: "env(safe-area-inset-left)",
				}}
			>
				{isLoggedIn && user ? (
					<>
						{/* user profile section at top */}
						<Box
							sx={{
								p: 2,
								borderBottom: `1px solid ${theme.palette.divider}`,
							}}
						>
							<Box
								component={RouterLink}
								to={`/profile/${user.handle}`}
								onClick={onClose}
								sx={{
									display: "flex",
									alignItems: "center",
									gap: 1.5,
									textDecoration: "none",
									color: "inherit",
								}}
							>
								<Avatar src={fullAvatarUrl} sx={{ width: 48, height: 48 }}>
									{user.username?.charAt(0).toUpperCase()}
								</Avatar>
								<Box sx={{ minWidth: 0 }}>
									<Typography variant="subtitle1" fontWeight={700} noWrap>
										{user.username}
									</Typography>
									<Typography variant="body2" color="text.secondary" noWrap>
										@{user.handle}
									</Typography>
								</Box>
							</Box>
						</Box>

						{/* dangerous actions at bottom (settings, logout) */}
						{renderSection(topNavItems)}

						{/* middle items (profile, favorites, admin) */}
						{renderSection(middleNavItems)}

						{/* frequent actions at bottom (home, explore, communities, messages, notifications) */}
						{renderSection([...publicNavItems, ...authenticatedNavItems], false)}
					</>
				) : (
					<>
						{renderSection(publicNavItems)}
						<Box sx={{ p: 3, textAlign: "center" }}>
							<Typography variant="body1" sx={{ mb: 2 }}>
								{t("auth.sign_in_prompt")}
							</Typography>
							<Box
								component={RouterLink}
								to="/login"
								onClick={onClose}
								sx={{
									display: "block",
									py: 1.5,
									px: 3,
									bgcolor: theme.palette.primary.main,
									color: "white",
									borderRadius: 9999,
									textDecoration: "none",
									fontWeight: 700,
									mb: 1.5,
								}}
							>
								{t("auth.login")}
							</Box>
							<Box
								component={RouterLink}
								to="/register"
								onClick={onClose}
								sx={{
									display: "block",
									py: 1.5,
									px: 3,
									border: `1px solid ${theme.palette.divider}`,
									color: theme.palette.text.primary,
									borderRadius: 9999,
									textDecoration: "none",
									fontWeight: 700,
								}}
							>
								{t("auth.join")}
							</Box>
						</Box>
					</>
				)}
			</Box>
		</>
	);
};

export default MobileDrawer;
