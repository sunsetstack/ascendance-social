import React, { lazy, Suspense, useMemo } from "react";
import { Alert, Box, Button, IconButton, Tab, Tabs, Tooltip } from "@mui/material";
import { Plus } from "lucide-react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useFollowingFeed, useNewFeed, usePosts, useTrendingFeed } from "../hooks/posts/usePosts";
import { useInterestFeed } from "../hooks/posts/useInterestFeed";
import axiosClient from "../api/axiosClient";
import type { InterestsResult } from "../features/feed/interests";
import Gallery from "../components/Gallery";
import { PageSeo } from "../lib/PageSeo";
import { buildHomeMetadata } from "../lib/seo";
import { useAuth } from "../hooks/context/useAuth";
import { useTranslation } from "react-i18next";
import { feedIdentities } from "../features/feed/feedIdentity";

const CreatePost = lazy(() => import("../components/CreatePost"));

const Home: React.FC = () => {
	const { isLoggedIn, user, loading } = useAuth();
	const { t, i18n } = useTranslation();
	const [params, setParams] = useSearchParams();
	const requested = params.get("feed");
	const mode = requested === "interests" || requested === "trending" || (isLoggedIn && (requested === "following" || requested === "foryou"))
		? requested : "latest";
	const topic = params.get("topic") ?? "";
	const catalogue = useQuery({
		queryKey: ["interests", user?.publicId ?? "guest"],
		queryFn: async ({ signal }) => (await axiosClient.get<InterestsResult>("/api/feed/interests", { signal })).data,
		enabled: !loading,
	});
	const validTopic = !!catalogue.data?.catalogue.some((item) => item.id === topic) && params.getAll("topic").length <= 1;
	const selected = catalogue.data?.profile?.selected ?? [];
	const topics = catalogue.data?.catalogue.filter((item) => !selected.length || selected.includes(item.id) || (mode === "interests" && item.id === topic)) ?? [];
	const personalized = usePosts({ enabled: !loading && mode === "foryou" });
	const latest = useNewFeed({ enabled: !loading && mode === "latest" });
	const following = useFollowingFeed(!loading && mode === "following");
	const trending = useTrendingFeed({ enabled: !loading && mode === "trending" });
	const interests = useInterestFeed(topic, "newest", !loading && mode === "interests" && validTopic);
	const query = mode === "following" ? following : mode === "interests" ? interests
		: mode === "trending" ? trending : mode === "foryou" ? personalized : latest;
	const feedId = mode === "following" ? following.feedId : mode === "interests" ? interests.feedId
		: mode === "trending" ? feedIdentities.trending(user?.publicId)
		: mode === "foryou" ? feedIdentities.home(user?.publicId) : feedIdentities.latest(user?.publicId);
	const posts = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
	const tab = mode === "interests" ? (validTopic ? `topic:${topic}` : false) : mode;
	const changeFeed = (value: string): void => {
		setParams((current) => {
			const next = new URLSearchParams(current);
			next.delete("topic");
			if (value.startsWith("topic:")) {
				next.set("feed", "interests");
				next.set("topic", value.slice(6));
			} else next.set("feed", value);
			return next;
		});
	};
	return (
		<>
			<PageSeo {...buildHomeMetadata()} />
			<Box sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
				<Box sx={{ display: "flex", borderBottom: 1, borderColor: "divider", minWidth: 0, position: "sticky", top: { xs: 80, md: 0 }, zIndex: 20, bgcolor: "background.default" }}>
					<Tabs value={tab} onChange={(_event, value: string) => changeFeed(value)}
						aria-label={t("feed.ordering")} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
						sx={{ flex: 1, minWidth: 0, minHeight: 56, "& .MuiTab-root": { fontSize: "1.0625rem", fontWeight: 600, minHeight: 56, minWidth: 88, px: 2, color: "text.secondary", textTransform: "none" }, "& .MuiTab-root.Mui-selected": { color: "text.primary" }, "& .MuiTabs-scrollButtons": { width: 28 } }}>
						<Tab label={t("timeline.new")} value="latest" />
						{isLoggedIn && <Tab label={t("timeline.following")} value="following" />}
						{mode === "foryou" && <Tab label={t("timeline.for_you")} value="foryou" />}
						{mode === "trending" && <Tab label={t("timeline.trending")} value="trending" />}
						{topics.map((item) => <Tab key={item.id} label={i18n.resolvedLanguage?.startsWith("bg") ? item.nameBg : item.name} value={`topic:${item.id}`} />)}
					</Tabs>
					<Tooltip title={t("timeline.manage_interests")}><IconButton component={RouterLink} to="/interests" aria-label={t("timeline.manage_interests")} sx={{ alignSelf: "center", flexShrink: 0, mx: 0.5 }}><Plus size={20} /></IconButton></Tooltip>
				</Box>
				{isLoggedIn && <Box sx={{ px: 2, py: 2, borderBottom: 1, borderColor: "divider" }}>
					<Suspense fallback={null}><CreatePost compact /></Suspense>
				</Box>}
				{mode === "interests" && catalogue.isError ? <Alert severity="error" sx={{ m: 2 }} action={<Button onClick={() => void catalogue.refetch()}>{t("feed.retry")}</Button>}>{t("interests.load_failed")}</Alert>
					: mode === "interests" && catalogue.data && !validTopic ? <Alert severity="warning" sx={{ m: 2 }}>{t("feed.invalid_settings")}</Alert>
					: query.error ? <Alert severity="error" sx={{ m: 2 }} action={<Button color="inherit" onClick={() => void query.refetch()}>{t("feed.retry")}</Button>}>{t("feed.load_failed")}</Alert> :
					<Gallery key={feedId} posts={posts} fetchNextPage={query.fetchNextPage} hasNextPage={query.hasNextPage}
						isFetchingNext={query.isFetchingNextPage} isLoadingAll={loading || query.isLoading || (mode === "interests" && catalogue.isPending)} isFetchingAll={query.isFetching}
						feedId={feedId} onRefresh={query.refreshFeed} emptyTitle={t(mode === "following" ? "timeline.following_empty" : mode === "interests" ? "interests.empty" : "feed.empty_title")}
						emptyDescription={t(mode === "following" ? "timeline.following_empty_help" : mode === "interests" ? "interests.empty_help" : "feed.empty_description")}
						emptyAction={<Box sx={{ display: "flex", gap: 1, justifyContent: "center", flexWrap: "wrap" }}>
							<Button component={RouterLink} to="/discover?feed=latest" variant="outlined">{t("feed.browse_latest")}</Button>
							<Button component={RouterLink} to="/communities">{t("feed.find_communities")}</Button>
						</Box>} />}
			</Box>
		</>
	);
};
export default Home;
