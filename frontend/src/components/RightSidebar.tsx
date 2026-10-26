import { useEffect, useState } from "react";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/context/useAuth";
import { useSocket } from "../hooks/context/useSocket";
import { useNotifications } from "../hooks/notifications/useNotification";
import { useNewFeed } from "../hooks/posts/usePosts";
import axiosClient from "../api/axiosClient";
import type { InterestsResult } from "../features/feed/interests";
import SearchBox from "./SearchBox";

interface RightSidebarProps { onPostClick: () => void }

export default function RightSidebar({ onPostClick }: RightSidebarProps): React.ReactElement {
	const { t, i18n } = useTranslation();
	const { user, loading } = useAuth();
	const socket = useSocket();
	const [connected, setConnected] = useState(socket?.connected ?? false);
	const { notifications, isError, refetch } = useNotifications();
	const interests = useQuery({
		queryKey: ["interests", user?.publicId ?? "guest"],
		queryFn: async ({ signal }) => (await axiosClient.get<InterestsResult>("/api/feed/interests", { signal })).data,
		enabled: !loading,
	});
	const latest = useNewFeed({ enabled: !loading, limit: 5 });
	const question = latest.data?.pages.flatMap((page) => page.data).find((post) => post.body?.includes("?") && post.commentsCount === 0);
	const replies = user ? notifications.filter((item) => !item.isRead && ["comment", "comment_reply", "mention"].includes(item.actionType)
		&& item.targetId && ["post", "image", "comment"].includes(item.targetType ?? "")).slice(0, 2) : [];
	const chosen = interests.data?.catalogue.filter((topic) => interests.data?.profile?.selected.includes(topic.id)) ?? [];
	const cardSx = { p: 2, border: 1, borderColor: "divider", borderRadius: 4, bgcolor: "background.default", minWidth: 0 };

	useEffect(() => {
		setConnected(socket?.connected ?? false);
		if (!socket) return;
		const connect = (): void => setConnected(true);
		const disconnect = (): void => setConnected(false);
		socket.on("connect", connect);
		socket.on("disconnect", disconnect);
		return () => { socket.off("connect", connect); socket.off("disconnect", disconnect); };
	}, [socket]);

	return (
		<Box component="aside" aria-label={t("timeline.now")} sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
			<Box sx={{ "& > form": { borderRadius: 999, bgcolor: "transparent" } }}><SearchBox /></Box>
			<Box component="section" sx={cardSx}>
			<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
				<Typography component="h2" sx={{ fontSize: "1.375rem", fontWeight: 700 }}>{t("timeline.now")}</Typography>
				<Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
					<Box component="span" sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: connected ? "#57d5a1" : "text.secondary" }} />
					{connected ? t("timeline.live") : t("timeline.offline")}
				</Typography>
			</Box>
			<Box sx={{ mt: 2 }}>
				<Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t("timeline.continue_conversation")}</Typography>
				{isError ? <Button onClick={() => void refetch()}>{t("feed.retry")}</Button> : replies.length ? replies.map((reply) => (
					<Box key={reply.id} sx={{ mb: 1.5 }}>
						<Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{reply.targetPreview || t("timeline.reply_from", { name: reply.actorUsername || reply.actorHandle || t("post.unknown_user") })}</Typography>
						<Button component={RouterLink} to={`/posts/${reply.targetId}#comments`} sx={{ px: 0, mt: 0.5 }}>{t("timeline.open_replies")} →</Button>
					</Box>
				)) : <><Typography variant="body2">{t("timeline.no_replies")}</Typography><Button component={RouterLink} to={user ? "/notifications" : "/login"} sx={{ px: 0, mt: 0.75 }}>{user ? t("nav.notifications") : t("auth.login")} →</Button></>}
			</Box>
			</Box>
			<Box component="section" sx={cardSx}>
				<Typography component="h3" variant="body1" fontWeight={700} sx={{ mb: 1 }}>{t("timeline.join_conversation")}</Typography>
				{question ? <><Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{question.body?.slice(0, 160)}</Typography><Button component={RouterLink} to={`/posts/${question.publicId}#comments`} sx={{ px: 0, mt: 0.5 }}>{t("timeline.first_reply")} →</Button></> :
					<><Typography variant="body2">{t("timeline.discover_conversation")}</Typography><Button component={RouterLink} to="/discover?feed=latest" sx={{ px: 0, mt: 0.5 }}>{t("feed.browse_latest")} →</Button></>}
			</Box>
			<Box component="section" sx={cardSx}>
				<Typography component="h3" variant="body1" fontWeight={700}>{t("interests.chosen")}</Typography>
				{interests.isError ? <Button onClick={() => void interests.refetch()}>{t("feed.retry")}</Button> : chosen.length ?
					<Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75} sx={{ my: 1.5 }}>{chosen.map((topic) => <Chip key={topic.id}
						label={i18n.resolvedLanguage?.startsWith("bg") ? topic.nameBg : topic.name} size="small" component={RouterLink} clickable
						to={`/interests?topic=${topic.id}`} sx={{ bgcolor: "#172431", color: "#b4ddf2", borderColor: "#2a4255" }} />)}</Stack> :
					<Typography variant="body2" sx={{ my: 1.5 }}>{t("timeline.choose_topics")}</Typography>}
				<Button component={RouterLink} to="/interests" sx={{ px: 0 }}>{t("timeline.manage_interests")} →</Button>
			</Box>
			<Box component="section" sx={cardSx}>
				<Typography variant="caption" sx={{ color: "primary.main", letterSpacing: "0.04em" }}>{t("timeline.prompt_eyebrow")}</Typography>
				<Typography component="h3" sx={{ fontWeight: 700, my: 1 }}>{t("timeline.prompt_title")}</Typography>
				<Typography variant="body2" color="text.secondary">{t("timeline.prompt_body")}</Typography>
				<Button variant="outlined" fullWidth onClick={onPostClick} sx={{ mt: 2 }}>{t("timeline.add_take")}</Button>
			</Box>
		</Box>
	);
}
