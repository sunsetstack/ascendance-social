import React from "react";
import { Link as RouterLink, useLocation } from "react-router-dom";
import { Paper, BottomNavigation, BottomNavigationAction, Box, Badge } from "@mui/material";
import { useBottomNav } from "../context/BottomNav/BottomNavContext";
import {
	Home as HomeIcon,
	Search as SearchIcon,
	Notifications as NotificationsIcon,
	MailOutline as MailIcon,
	Groups as GroupsIcon,
	Login as LoginIcon,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useNotifications } from "../hooks/notifications/useNotification";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/context/useAuth";

const BottomNav: React.FC = () => {
	const { t } = useTranslation();
	const { notifications } = useNotifications();
	const location = useLocation();
	const theme = useTheme();
	const { isVisible } = useBottomNav();
	const { isLoggedIn } = useAuth();

	const unreadCount = notifications.filter((n) => !n.isRead).length;

	const getValue = () => {
		const path = location.pathname;
		if (path === "/") return 0;
		if (path.startsWith("/discover")) return 1;
		if (path.startsWith("/communities")) return 2;
		if (!isLoggedIn && (path === "/login" || path === "/register")) return 3;
		if (path === "/notifications") return 3;
		if (path === "/messages") return 4;
		return 0;
	};

	return (
		<Box
			data-testid="bottom-navigation"
			sx={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				zIndex: 1000,
				transform: isVisible ? "translateY(0)" : "translateY(100%)",
				transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
				willChange: "transform",
				backfaceVisibility: "hidden",
			}}
		>
			<Paper elevation={3} sx={{ pb: "env(safe-area-inset-bottom)" }}>
				<BottomNavigation
					showLabels={false}
					value={getValue()}
					sx={{
						bgcolor: "background.default",
						borderTop: `1px solid ${theme.palette.divider}`,
						height: 56,
					}}
				>
					<BottomNavigationAction
						component={RouterLink}
						to="/"
						label={t("nav.home")}
						icon={<HomeIcon />}
						sx={{
							color: "text.secondary",
							"&.Mui-selected": { color: "primary.main" },
						}}
					/>

					<BottomNavigationAction
						component={RouterLink}
						to="/discover"
						label={t("nav.explore")}
						icon={<SearchIcon />}
						sx={{
							color: "text.secondary",
							"&.Mui-selected": { color: "primary.main" },
						}}
					/>
					<BottomNavigationAction
						component={RouterLink}
						to="/communities"
						label={t("nav.communities")}
						icon={<GroupsIcon />}
						sx={{
							color: "text.secondary",
							"&.Mui-selected": { color: "primary.main" },
						}}
					/>

					{isLoggedIn ? (
						<>
							<BottomNavigationAction
								component={RouterLink}
								to="/notifications"
								label={t("nav.notifications")}
								icon={
									<Badge badgeContent={unreadCount} color="primary">
										<NotificationsIcon />
									</Badge>
								}
								sx={{
									color: "text.secondary",
									"&.Mui-selected": { color: "primary.main" },
								}}
							/>
							<BottomNavigationAction
								component={RouterLink}
								to="/messages"
								label={t("nav.messages")}
								icon={<MailIcon />}
								sx={{
									color: "text.secondary",
									"&.Mui-selected": { color: "primary.main" },
								}}
							/>
						</>
					) : (
						<BottomNavigationAction
							component={RouterLink}
							to="/login"
							label={t("auth.login")}
							icon={<LoginIcon />}
							sx={{
								color: "text.secondary",
								"&.Mui-selected": { color: "primary.main" },
							}}
						/>
					)}
				</BottomNavigation>
			</Paper>
		</Box>
	);
};

export default BottomNav;
