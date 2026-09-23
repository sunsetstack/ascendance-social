import { useQuery, useQueryClient } from "@tanstack/react-query";
import { searchQuery } from "../../api/searchApi";
import { mapPost } from "../../lib/mappers";
import { useIsFeedRestoreNavigation } from "../../features/feed/feedRestoration";

export const useSearch = (query: string, feedId: string) => {
	const queryClient = useQueryClient();
	const isRestoreNavigation = useIsFeedRestoreNavigation(feedId);

	const searchResults = useQuery({
		queryKey: ["query", query, feedId],
		queryFn: () => searchQuery(query),
		staleTime: 0,
		enabled: !!query, // run when query exists
		retry: 1,
		...(isRestoreNavigation ? { refetchOnMount: false } : {}),
		select: (data) => {
			return {
				...data,
				data: {
					...data.data,
					// Map the raw posts to the IPost interface
					posts: data.data.posts ? data.data.posts.map(mapPost) : [],
					users: data.data.users || [],
					communities: data.data.communities || [],
				},
			};
		},
	});

	const invalidateSearch = () => {
		queryClient.invalidateQueries({
			queryKey: ["query", query, feedId],
			exact: true,
		});
	};

	return { ...searchResults, invalidateSearch };
};
