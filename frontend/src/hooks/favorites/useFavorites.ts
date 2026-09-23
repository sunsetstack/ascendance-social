import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchUserFavorites } from "../../api/favoritesApi";
import { mapImage } from "../../lib/mappers";
import { useAuth } from "../context/useAuth";
import { IImage } from "../../types";
import { feedIdentities } from "../../features/feed/feedIdentity";
import { useIsFeedRestoreNavigation } from "../../features/feed/feedRestoration";

interface FavoritesPage {
	data: IImage[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
}

export const useFavorites = (options?: { limit?: number }) => {
	const { isLoggedIn, user } = useAuth();
	const pageSize = options?.limit ?? 12;
	const feedId = feedIdentities.favorites(user?.publicId);
	const isRestoreNavigation = useIsFeedRestoreNavigation(feedId);

	return useInfiniteQuery<FavoritesPage, Error>({
		queryKey: ["favorites", "user", feedId, pageSize],
		queryFn: async ({ pageParam = 1 }) => {
			const response = await fetchUserFavorites(pageParam as number, pageSize);
			return {
				...response,
				data: response.data.map((raw) => mapImage(raw)),
			};
		},
		getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
		initialPageParam: 1,
		enabled: isLoggedIn,
		staleTime: 0,
		refetchOnWindowFocus: false,
		...(isRestoreNavigation ? { refetchOnMount: false } : {}),
	});
};
