import React, { lazy, Suspense, useMemo } from "react";
import { usePosts } from "../hooks/posts/usePosts";
import Gallery from "../components/Gallery";
import { Box, Typography, useMediaQuery, useTheme, Card, Skeleton, CardActions, alpha } from "@mui/material";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { PageSeo } from "../lib/PageSeo";
import { buildHomeMetadata } from "../lib/seo";
import { useAuth } from "../hooks/context/useAuth";
import { useTranslation } from "react-i18next";

const CreatePost = lazy(() => import("../components/CreatePost"));

const Home: React.FC = () => {
	const theme = useTheme();
	const isMobile = useMediaQuery(theme.breakpoints.down("md"));
	const { isLoggedIn } = useAuth();
	const { t } = useTranslation();

	// backend picks personalized vs trending based on auth present in the request
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } = usePosts();

	const activePosts = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);
	const feedHeader = (
		<Box
			component="header"
			sx={{
				position: "sticky",
				top: 0,
				zIndex: 4,
				display: "flex",
				alignItems: "center",
				gap: 1.5,
				px: 2.5,
				py: 1.75,
				borderBottom: `1px solid ${theme.palette.divider}`,
				bgcolor: alpha(theme.palette.background.default, 0.82),
				backdropFilter: "blur(18px)",
			}}
		>
			<Box
				sx={{
					width: 38,
					height: 38,
					borderRadius: 2.5,
					display: "grid",
					placeItems: "center",
					flexShrink: 0,
					background: "linear-gradient(145deg, rgba(56, 189, 248, 0.22), rgba(139, 92, 246, 0.2))",
					border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
				}}
			>
				<AutoAwesomeRoundedIcon sx={{ fontSize: 20, color: "primary.light" }} />
			</Box>
			<Box sx={{ minWidth: 0 }}>
				<Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: "-0.025em", lineHeight: 1.25 }}>
					{isLoggedIn ? t("nav.home") : t("marketing.guest_feed_title")}
				</Typography>
				{!isLoggedIn && (
					<Typography variant="body2" color="text.secondary" noWrap>
						{t("marketing.guest_feed_subtitle")}
					</Typography>
				)}
			</Box>
		</Box>
	);

	if (isLoading) {
		return (
			<>
				<PageSeo {...buildHomeMetadata()} />
				{feedHeader}
				<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", mt: 1.5 }}>
					<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%" }}>
						{Array.from({ length: 3 }).map((_, i) => (
							<Card
								key={i}
								sx={{
									width: "100%",
									borderBottom: "1px solid rgba(99, 102, 241, 0.1)",
									borderRadius: 0,
									boxShadow: "none",
								}}
							>
								<Skeleton variant="rectangular" height={400} sx={{ bgcolor: "rgba(99, 102, 241, 0.1)" }} />
								<CardActions sx={{ p: 2 }}>
									<Skeleton variant="text" width="60%" height={24} />
									<Skeleton variant="circular" width={40} height={40} sx={{ ml: "auto" }} />
								</CardActions>
							</Card>
						))}
					</Box>
				</Box>
			</>
		);
	}

	return (
		<>
			<PageSeo {...buildHomeMetadata()} />
			<Box sx={{ display: "flex", flexDirection: "column" }}>
				{feedHeader}
				{/* CreatePost decides whether it should render or not - hide on mobile */}
				{!isMobile && isLoggedIn && (
					<Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}>
						<Suspense fallback={null}>
							<CreatePost />
						</Suspense>
					</Box>
				)}

				<Box
					sx={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
					}}
				>
					{error ? (
						<Box>
							<Typography color="error" sx={{ textAlign: "center", py: 4, fontSize: "1.1rem" }}>
								Error fetching images: {error.message}
							</Typography>
						</Box>
					) : (
						<Gallery
							key={`posts-feed`}
							posts={activePosts}
							fetchNextPage={fetchNextPage}
							hasNextPage={hasNextPage}
							isFetchingNext={isFetchingNextPage}
							isLoadingAll={isLoading}
						/>
					)}
				</Box>
			</Box>
		</>
	);
};

export default Home;
