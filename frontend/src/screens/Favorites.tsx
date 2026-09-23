import { Box, Typography, useTheme, IconButton } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate } from "react-router-dom";
import Gallery from "../components/Gallery";
import { useFavorites } from "../hooks/favorites/useFavorites";
import { useAuth } from "../hooks/context/useAuth";
import { feedIdentities } from "../features/feed/feedIdentity";

const Favorites = () => {
	const theme = useTheme();
	const navigate = useNavigate();
	const { isLoggedIn, user } = useAuth();
	const favoritesQuery = useFavorites();
	const feedId = feedIdentities.favorites(user?.publicId);

	const { data, error, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = favoritesQuery;

	const posts = data?.pages.flatMap((page) => page.data) ?? [];

	if (!isLoggedIn) {
		return (
			<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "60vh" }}>
				<Typography variant="h6" color="text.secondary">
					You need to be logged in to view your favorites.
				</Typography>
			</Box>
		);
	}

	return (
		<Box
			sx={{
				display: "flex",
				flexGrow: 1,
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			{/* Sticky Header */}
			<Box
				sx={{
					position: "sticky",
					top: 0,
					zIndex: 1000,
					bgcolor: "rgba(0, 0, 0, 0.65)",
					backdropFilter: "blur(12px)",
					borderBottom: `1px solid ${theme.palette.divider}`,
					px: 2,
					py: 1,
					display: "flex",
					alignItems: "center",
					gap: 2,
				}}
			>
				<IconButton
					onClick={() => navigate(-1)}
					size="small"
					aria-label="Go back"
				>
					<ArrowBackIcon />
				</IconButton>
				<Box>
					<Typography variant="h6" sx={{ lineHeight: 1.2, fontWeight: 700 }}>
						Favorites
					</Typography>
					<Typography variant="caption" color="text.secondary">
						@{user?.handle}
					</Typography>
				</Box>
			</Box>

			<Box
				sx={{
					flexGrow: 1,
					overflowY: "auto",
					p: 0,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
				}}
			>
				{error ? (
					<Box sx={{ textAlign: "center", mt: 6 }}>
						<Typography variant="body1" color="error">
							We couldn't load your favorites: {error.message}
						</Typography>
					</Box>
				) : (
					<Gallery
						posts={posts}
						fetchNextPage={fetchNextPage}
						hasNextPage={!!hasNextPage}
						isFetchingNext={isFetchingNextPage}
						isLoadingAll={isLoading}
						isFetchingAll={favoritesQuery.isFetching}
						feedId={feedId}
						onRefresh={async () => {
							await favoritesQuery.refetch({ throwOnError: true });
						}}
						emptyTitle="No favorites yet"
						emptyDescription="Tap the heart icon on any image to save it to your favorites."
					/>
				)}
			</Box>
		</Box>
	);
};

export default Favorites;
