import { QueryClient, QueryKey } from "@tanstack/react-query";
import { IPost, PaginatedResponse } from "../../types";
import { mapPost } from "../../lib/mappers";

export const refreshFirstFeedPage = async (
	queryClient: QueryClient,
	queryKey: QueryKey,
	fetchPage: () => Promise<PaginatedResponse<IPost>>,
): Promise<void> => {
	await queryClient.cancelQueries({ queryKey, exact: true });
	const response = await fetchPage();
	await queryClient.cancelQueries({ queryKey, exact: true });
	queryClient.setQueryData(queryKey, {
		pages: [{ ...response, data: response.data.map(mapPost) }],
		pageParams: [1],
	});
};

const POST_INTERACTION_CACHE_KEYS = new Set<string>([
	"followingFeed",
	"posts",
	"personalizedFeed",
	"userPosts",
	"forYouFeed",
	"feedPreview",
	"hotTopicPosts",
	"interestFeed",
	"trendingFeed",
	"newFeed",
	"images",
	"userImages",
	"post",
	"image",
	"postsByTag",
	"favorites",
	"community-posts",
	"userLikedPosts",
	"userPostsPage",
	"userLikedPostsPage",
	"query",
]);

export const postInteractionQueryFilter = {
	predicate: ({ queryKey }: { queryKey: QueryKey }): boolean =>
		typeof queryKey[0] === "string" && POST_INTERACTION_CACHE_KEYS.has(queryKey[0]),
};

export const updatePostInCache = (
	data: unknown,
	publicId: string,
	updater: (post: IPost) => IPost,
): unknown => {
	if (!data || typeof data !== "object") return data;
	if (Array.isArray(data)) {
		const items = data.map((item) => updatePostInCache(item, publicId, updater));
		return items.some((item, index) => item !== data[index]) ? items : data;
	}
	if ("publicId" in data && data.publicId === publicId && "likes" in data) {
		return updater(data as IPost);
	}
	const record = data as Record<string, unknown>;
	let result = record;
	for (const key of ["pages", "data", "posts", "repostOf"] as const) {
		if (!record[key] || typeof record[key] !== "object") continue;
		const updated = updatePostInCache(record[key], publicId, updater);
		if (updated !== record[key]) result = { ...result, [key]: updated };
	}
	return result;
};

export const removePostFromFeedCaches = (
	queryClient: QueryClient,
	publicId: string,
): void => {
	const filterOutDeletedPost = (data: unknown): unknown => {
		if (!data || typeof data !== "object") return data;
		if (Array.isArray(data)) {
			const items = data.filter((item) =>
				!item || typeof item !== "object" || item.publicId !== publicId,
			).map(filterOutDeletedPost);
			return items.length !== data.length || items.some((item, index) => item !== data[index])
				? items : data;
		}
		const record = data as Record<string, unknown>;
		let result = record;
		for (const key of ["pages", "data", "posts"] as const) {
			const updated = filterOutDeletedPost(record[key]);
			if (updated !== record[key]) result = { ...result, [key]: updated };
		}
		return result;
	};

	queryClient.setQueriesData(postInteractionQueryFilter, filterOutDeletedPost);
};

export const removePostDetailAndCommentCaches = (
	queryClient: QueryClient,
	postPublicId: string,
): void => {
	queryClient.removeQueries({
		predicate: ({ queryKey, state }) => {
			return (
				((queryKey[0] === "post" || queryKey[0] === "image") &&
					(queryKey.includes(postPublicId) || (state.data as IPost | undefined)?.publicId === postPublicId)) ||
				(queryKey[0] === "comments" && queryKey[1] === "post" && queryKey[2] === postPublicId)
			);
		},
	});
};

export const updatePostCaches = (
	queryClient: QueryClient,
	postPublicId: string,
	updater: (post: IPost) => IPost,
): void => {
	queryClient.setQueriesData(postInteractionQueryFilter, (data: unknown) =>
		updatePostInCache(data, postPublicId, updater),
	);
};
