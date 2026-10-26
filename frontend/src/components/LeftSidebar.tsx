import { useState } from "react";
import { Avatar, Badge, Box, Divider, IconButton, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { Bell, Bookmark, Compass, Ellipsis, House, Languages, LogOut, Mail, Plus, Settings, Shield, SlidersHorizontal, UserRound, UsersRound } from "lucide-react";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/context/useAuth";
import { useNotifications } from "../hooks/notifications/useNotification";
import { buildAvatarUrl } from "../lib/media";

interface LeftSidebarProps {
	onPostClick: () => void;
}

export default function LeftSidebar({ onPostClick }: LeftSidebarProps): React.ReactElement {
	const { t, i18n } = useTranslation();
	const { user, isLoggedIn, logout } = useAuth();
	const { notifications } = useNotifications();
	const location = useLocation();
	const navigate = useNavigate();
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const unread = isLoggedIn ? notifications.filter((item) => !item.isRead).length : 0;
	const items = [
		{ label: t("nav.home"), path: "/", icon: <House size={22} strokeWidth={1.6} /> },
		{ label: t("nav.explore"), path: "/discover", icon: <Compass size={22} strokeWidth={1.6} /> },
		{ label: t("interests.title"), path: "/interests", icon: <SlidersHorizontal size={22} strokeWidth={1.6} /> },
		{ label: t("nav.communities"), path: "/communities", icon: <UsersRound size={22} strokeWidth={1.6} /> },
		...(isLoggedIn ? [
			{ label: t("nav.notifications"), path: "/notifications", icon: <Badge badgeContent={unread} color="primary"><Bell size={22} strokeWidth={1.6} /></Badge> },
			{ label: t("nav.messages"), path: "/messages", icon: <Mail size={22} strokeWidth={1.6} /> },
		] : []),
	];
	const active = (path: string): boolean => path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);
	const closeMenu = (): void => setAnchor(null);
	const go = (path: string): void => { closeMenu(); navigate(path); };

	return (
		<Box component="nav" aria-label={t("timeline.navigation")} data-testid="left-sidebar"
			sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, py: 2, px: { md: 1, lg: 2 }, height: "100%" }}>
			{items.map((item) => (
				<Tooltip title={item.label} placement="right" key={item.path}>
					<IconButton component={RouterLink} to={item.path} aria-label={item.label} aria-current={active(item.path) ? "page" : undefined}
						sx={{ width: { md: 56, lg: "100%" }, height: 52, px: { md: 0, lg: 2 }, justifyContent: { md: "center", lg: "flex-start" }, gap: 2, borderRadius: 3, color: active(item.path) ? "text.primary" : "text.secondary", bgcolor: active(item.path) ? "#18232e" : "transparent" }}>
						{item.icon}
						<Typography component="span" sx={{ display: { md: "none", lg: "block" }, fontSize: "1.25rem", fontWeight: active(item.path) ? 700 : 400 }}>{item.label}</Typography>
					</IconButton>
				</Tooltip>
			))}
			<Tooltip title={t("timeline.more")} placement="right">
				<IconButton aria-label={t("timeline.more")} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={(event) => setAnchor(event.currentTarget)}
					sx={{ width: { md: 56, lg: "100%" }, height: 52, px: { md: 0, lg: 2 }, justifyContent: { md: "center", lg: "flex-start" }, gap: 2, borderRadius: 3 }}><Ellipsis size={24} strokeWidth={1.6} /><Typography component="span" sx={{ display: { md: "none", lg: "block" }, fontSize: "1.25rem" }}>{t("timeline.more")}</Typography></IconButton>
			</Tooltip>
			<Tooltip title={t("nav.post")} placement="right">
				<IconButton aria-label={t("timeline.create_post")} data-testid="post-button" onClick={onPostClick}
					sx={{ mt: 2, width: { md: 52, lg: "100%" }, height: 52, borderRadius: 3, bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.light", color: "primary.contrastText" } }}>
					<Box sx={{ display: { md: "flex", lg: "none" } }}><Plus size={27} strokeWidth={2} /></Box><Typography component="span" fontWeight={700} sx={{ display: { md: "none", lg: "block" } }}>{t("nav.post")}</Typography>
				</IconButton>
			</Tooltip>
			<Box sx={{ mt: "auto", pt: 3, width: { lg: "100%" } }}>
				<Tooltip title={user ? `@${user.handle}` : t("auth.login")} placement="right">
					<IconButton aria-label={user ? t("nav.profile") : t("auth.login")} component={RouterLink} to={user ? `/profile/${user.handle}` : "/login"} sx={{ width: { lg: "100%" }, borderRadius: 3, justifyContent: { lg: "flex-start" }, gap: 1.5 }}>
						{user ? <Avatar src={buildAvatarUrl(user.avatar, 40)} sx={{ width: 36, height: 36 }}>{user.username?.charAt(0)}</Avatar> : <UserRound size={22} />}
						<Box sx={{ display: { md: "none", lg: "block" }, minWidth: 0, textAlign: "left" }}><Typography noWrap fontWeight={700}>{user?.username ?? t("auth.login")}</Typography>{user && <Typography noWrap variant="body2" color="text.secondary">@{user.handle}</Typography>}</Box>
					</IconButton>
				</Tooltip>
			</Box>
			<Menu anchorEl={anchor} open={Boolean(anchor)} onClose={closeMenu} anchorOrigin={{ vertical: "top", horizontal: "right" }}
				sx={{ "& .MuiMenuItem-root": { gap: 1.5, minHeight: 44 } }}>
				<MenuItem onClick={() => go("/discover?feed=latest")}><Compass size={18} />{t("feed.latest")}</MenuItem>
				{isLoggedIn && <MenuItem onClick={() => go(`/profile/${user?.handle}`)}><UserRound size={18} />{t("nav.profile")}</MenuItem>}
				{isLoggedIn && <MenuItem onClick={() => go("/favorites")}><Bookmark size={18} />{t("nav.favorites")}</MenuItem>}
				{isLoggedIn && <MenuItem onClick={() => go("/settings")}><Settings size={18} />{t("nav.settings")}</MenuItem>}
				{user && "isAdmin" in user && user.isAdmin && <MenuItem onClick={() => go("/admin")}><Shield size={18} />{t("nav.admin")}</MenuItem>}
				<Divider />
				<MenuItem onClick={() => { void i18n.changeLanguage(i18n.resolvedLanguage?.startsWith("bg") ? "en" : "bg"); closeMenu(); }}><Languages size={18} />{i18n.resolvedLanguage?.startsWith("bg") ? "English" : "Български"}</MenuItem>
				{isLoggedIn ? <MenuItem onClick={() => { closeMenu(); void logout(); navigate("/"); }}><LogOut size={18} />{t("auth.logout")}</MenuItem> : <MenuItem onClick={() => go("/login")}>{t("auth.login")}</MenuItem>}
			</Menu>
		</Box>
	);
}
