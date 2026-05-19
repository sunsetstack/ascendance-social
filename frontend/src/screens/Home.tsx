import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { usePosts } from "../hooks/posts/usePosts";
import Gallery from "../components/Gallery";
import CreatePost from "../components/CreatePost";
import { Box, Typography, useMediaQuery, useTheme, Card, Skeleton, CardActions } from "@mui/material";
import { PageSeo } from "../lib/PageSeo";
import { buildHomeMetadata } from "../lib/seo";

const Home: React.FC = () => {
	const theme = useTheme();
	const isMobile = useMediaQuery(theme.breakpoints.down("md"));

	// backend picks personalized vs trending based on auth present in the request
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } = usePosts();

	const activePosts = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

	if (isLoading) {
		return (
			<>
				<PageSeo {...buildHomeMetadata()} />
				<Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", mt: 2 }}>
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
			<Box sx={{ display: "flex", flexDirection: "column", mt: 2 }}>
				{/* CreatePost decides whether it should render or not - hide on mobile */}
				{!isMobile && <CreatePost />}

				<Box
					sx={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
					}}
				>
					{error ? (
						<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
							<Typography color="error" sx={{ textAlign: "center", py: 4, fontSize: "1.1rem" }}>
								Error fetching images: {error.message}
							</Typography>
						</motion.div>
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
