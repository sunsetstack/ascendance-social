import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Box, Typography, Tabs, Tab, useTheme, alpha, IconButton, Tooltip, useMediaQuery } from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

import Gallery from "../components/Gallery";
import { useAuth } from "../hooks/context/useAuth";
import { useTrendingFeed, useNewFeed, useForYouFeed } from "../hooks/posts/usePosts";
import { PageSeo } from "../lib/PageSeo";
import { buildDiscoveryMetadata } from "../lib/seo";

interface TabPanelProps {
	children?: React.ReactNode;
	index: number;
	value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index, ...other }) => {
	return (
		<div
			role="tabpanel"
			hidden={value !== index}
			id={`discovery-tabpanel-${index}`}
			aria-labelledby={`discovery-tab-${index}`}
			{...other}
		>
			{value === index && <Box>{children}</Box>}
		</div>
	);
};

// map feed names to tab indices
const feedToIndex: Record<string, number> = {
	latest: 0,
	new: 0,
	trending: 1,
	foryou: 2,
	following: 0, // fallback to new/latest for now
};

const Discovery: React.FC = () => {
	const theme = useTheme();
	const isMobile = useMediaQuery(theme.breakpoints.down("md"));
	const [searchParams, setSearchParams] = useSearchParams();
	const { isLoggedIn, loading: authLoading } = useAuth();

	// check if we have a specific feed requested via URL param
	const requestedFeed = searchParams.get("feed");
	const displayedFeed = !isLoggedIn && requestedFeed === "foryou" ? "latest" : requestedFeed;
	const isSingleFeedMode = isMobile && !!displayedFeed;
	const initialTab = displayedFeed ? (feedToIndex[displayedFeed] ?? 0) : 0;

	const [activeTab, setActiveTab] = useState<number>(initialTab);
	const [isRefreshing, setIsRefreshing] = useState(false);

	// sync tab with URL param when it changes
	useEffect(() => {
		if (authLoading) return;

		if (!isLoggedIn && requestedFeed === "foryou") {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					next.set("feed", "latest");
					return next;
				},
				{ replace: true },
			);
		}

		setActiveTab(displayedFeed ? (feedToIndex[displayedFeed] ?? 0) : 0);
	}, [authLoading, displayedFeed, isLoggedIn, requestedFeed, setSearchParams]);

	const trendingFeedQuery = useTrendingFeed({ enabled: activeTab === 1 });
	const newFeedQuery = useNewFeed({ enabled: activeTab === 0 });
	const forYouFeedQuery = useForYouFeed({ enabled: isLoggedIn && activeTab === 2 });

	const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
		setActiveTab(newValue);
	};

	const handleRefreshNewFeed = async () => {
		if (!isLoggedIn || isRefreshing) return;
		setIsRefreshing(true);
		try {
			await newFeedQuery.refreshFeed();
			await newFeedQuery.refetch();
		} finally {
			setIsRefreshing(false);
		}
	};

	// get feed title for single feed mode
	const getFeedTitle = () => {
		switch (displayedFeed) {
			case "trending": return "Trending";
			case "latest":
			case "new": return "Latest";
			case "foryou": return "For You";
			case "following": return "Following";
			default: return "Explore";
		}
	};

	// Show loading during auth transitions
	if (authLoading) {
		return (
			<>
				<PageSeo {...buildDiscoveryMetadata({ feed: displayedFeed })} />
				<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "50vh" }}>
					<Typography>Loading...</Typography>
				</Box>
			</>
		);
	}

	return (
		<>
			<PageSeo {...buildDiscoveryMetadata({ feed: displayedFeed })} />
			<Box
				sx={{
					display: "flex",
					flexGrow: 1,
					height: isMobile ? "auto" : "100%",
					overflow: isMobile ? "visible" : "hidden",
				}}
			>
				{/* Main Content */}
				<Box
					component="main"
					sx={{
						flexGrow: 1,
						p: 0,
						overflowY: isMobile ? "visible" : "auto",
						height: isMobile ? "auto" : "100%",
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
					}}
				>
					{/* Single feed mode header (mobile only) */}
					{isSingleFeedMode && (
						<Box
							sx={{
								width: "100%",
								py: 1.5,
								px: 2,
								borderBottom: 1,
								borderColor: "divider",
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
							}}
						>
							<Typography variant="h6" fontWeight={700}>
								{getFeedTitle()}
							</Typography>
							{activeTab === 0 && isLoggedIn && (
								<Tooltip title="Refresh for latest posts">
									<IconButton
										onClick={handleRefreshNewFeed}
										disabled={isRefreshing}
										size="small"
										sx={{
											animation: isRefreshing ? "spin 1s linear infinite" : "none",
											"@keyframes spin": {
												"0%": { transform: "rotate(0deg)" },
												"100%": { transform: "rotate(360deg)" },
											},
										}}
									>
										<RefreshIcon />
									</IconButton>
								</Tooltip>
							)}
						</Box>
					)}

					{/* Tabs - hidden in single feed mode on mobile */}
					{!isSingleFeedMode && (
						<Box sx={{ width: "100%", borderBottom: 1, borderColor: "divider" }}>
							<Tabs
								value={activeTab}
								onChange={handleTabChange}
								aria-label="discovery feed tabs"
								variant="fullWidth"
								sx={{
									"& .MuiTabs-indicator": {
										height: 4,
										borderRadius: 2,
										bgcolor: "primary.main",
									},
									"& .MuiTab-root": {
										textTransform: "none",
										fontSize: "1rem",
										fontWeight: 700,
										minHeight: 53,
										color: "text.secondary",
										"&.Mui-selected": {
											color: "text.primary",
										},
										"&:hover": {
											backgroundColor: alpha(theme.palette.text.primary, 0.1),
										},
									},
								}}
							>
								<Tab label="Latest" id="discovery-tab-0" aria-controls="discovery-tabpanel-0" />
								<Tab label="Trending" id="discovery-tab-1" aria-controls="discovery-tabpanel-1" />
								{isLoggedIn && <Tab label="For You" id="discovery-tab-2" aria-controls="discovery-tabpanel-2" />}
							</Tabs>
						</Box>
					)}

					<Box sx={{ width: "100%" }}>
						{/* Tab Panels */}
						<TabPanel value={activeTab} index={0}>
							<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
								{!isSingleFeedMode && isLoggedIn && (
									<Box sx={{ display: "flex", justifyContent: "flex-end", px: 2, py: 1 }}>
										<Tooltip title="Refresh for latest posts">
											<IconButton
												onClick={handleRefreshNewFeed}
												disabled={isRefreshing}
												size="small"
												sx={{
													animation: isRefreshing ? "spin 1s linear infinite" : "none",
													"@keyframes spin": {
														"0%": { transform: "rotate(0deg)" },
														"100%": { transform: "rotate(360deg)" },
													},
												}}
											>
												<RefreshIcon />
											</IconButton>
										</Tooltip>
									</Box>
								)}
								<Gallery
									posts={newFeedQuery.data?.pages.flatMap((page) => page.data) || []}
									fetchNextPage={newFeedQuery.fetchNextPage}
									hasNextPage={!!newFeedQuery.hasNextPage}
									isFetchingNext={newFeedQuery.isFetchingNextPage}
									isLoadingAll={newFeedQuery.isLoading || newFeedQuery.isPending}
									isFetchingAll={newFeedQuery.isFetching}
								/>
							</motion.div>
						</TabPanel>

						<TabPanel value={activeTab} index={1}>
							<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
								<Gallery
									posts={trendingFeedQuery.data?.pages.flatMap((page) => page.data) || []}
									fetchNextPage={trendingFeedQuery.fetchNextPage}
									hasNextPage={!!trendingFeedQuery.hasNextPage}
									isFetchingNext={trendingFeedQuery.isFetchingNextPage}
									isLoadingAll={trendingFeedQuery.isLoading || trendingFeedQuery.isPending}
									isFetchingAll={trendingFeedQuery.isFetching}
								/>
							</motion.div>
						</TabPanel>

						{isLoggedIn && (
							<TabPanel value={activeTab} index={2}>
								<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
									<Gallery
										posts={forYouFeedQuery.data?.pages.flatMap((page) => page.data) || []}
										fetchNextPage={forYouFeedQuery.fetchNextPage}
										hasNextPage={!!forYouFeedQuery.hasNextPage}
										isFetchingNext={forYouFeedQuery.isFetchingNextPage}
										isLoadingAll={forYouFeedQuery.isLoading || forYouFeedQuery.isPending}
										isFetchingAll={forYouFeedQuery.isFetching}
									/>
								</motion.div>
							</TabPanel>
						)}
					</Box>

					{/* Empty State */}
					{!isLoggedIn && (
						<Box sx={{ textAlign: "center", py: 6, px: 2 }}>
							<Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
								Sign in to see your personalized "For You" feed based on your interests and interactions.
							</Typography>
						</Box>
					)}
				</Box>
			</Box>
		</>
	);
};

export default Discovery;
