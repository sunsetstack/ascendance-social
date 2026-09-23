import { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
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

type FeedPage = {
	data: IPost[];
	total: number;
	page: number;
	limit: number;
	totalPages: number;
};

type InfiniteFeed = InfiniteData<FeedPage>;
type FeedKey =
	| "posts"
	| "personalizedFeed"
	| "userPosts"
	| "forYouFeed"
	| "trendingFeed"
	| "newFeed"
	| "images"
	| "userImages"
	| "postsByTag";

const FEED_CACHE_KEYS: readonly FeedKey[] = [
	"posts",
	"personalizedFeed",
	"userPosts",
	"forYouFeed",
	"trendingFeed",
	"newFeed",
	"images",
	"userImages",
];

const LIKE_CACHE_KEYS: readonly FeedKey[] = FEED_CACHE_KEYS;

const POST_INTERACTION_CACHE_KEYS = new Set<string>([
	...FEED_CACHE_KEYS,
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
	for (const key of ["pages", "data", "posts"] as const) {
		if (!record[key] || typeof record[key] !== "object") continue;
		const updated = updatePostInCache(record[key], publicId, updater);
		if (updated !== record[key]) result = { ...result, [key]: updated };
	}
	return result;
};

const REPOST_CACHE_KEYS: readonly FeedKey[] = [
	"posts",
	"personalizedFeed",
	"trendingFeed",
	"newFeed",
	"forYouFeed",
	"postsByTag",
];

export const removePostFromFeedCaches = (
	queryClient: QueryClient,
	publicId: string,
	keys: readonly FeedKey[] = FEED_CACHE_KEYS,
) => {
	const filterOutDeletedPost = (oldData: unknown): unknown => {
		if (!oldData || typeof oldData !== "object") {
			return oldData;
		}

		if ("pages" in oldData) {
			const infiniteData = oldData as { pages: Array<{ data: Array<{ publicId: string }> }>; pageParams: unknown[] };
			return {
				...infiniteData,
				pages: infiniteData.pages.map((page) => ({
					...page,
					data: Array.isArray(page.data)
						? page.data.filter((item) => item.publicId !== publicId)
						: page.data,
				})),
			};
		}

		if ("data" in oldData) {
			const regularData = oldData as { data: Array<{ publicId: string }> };
			if (Array.isArray(regularData.data)) {
				return {
					...regularData,
					data: regularData.data.filter((item) => item.publicId !== publicId),
				};
			}
		}

		return oldData;
	};

	for (const key of keys) {
		queryClient.setQueriesData({ queryKey: [key] }, filterOutDeletedPost);
	}
};

const updateLikeCountInCache = (
	oldData: unknown,
	postPublicId: string,
	likes: number,
): unknown => {
	if (!oldData || typeof oldData !== "object") {
		return oldData;
	}

	if ("pages" in oldData) {
		const infiniteData = oldData as {
			pages: Array<{ data: IPost[] }>;
			pageParams: unknown[];
		};
		return {
			...infiniteData,
			pages: infiniteData.pages.map((page) => ({
				...page,
				data: Array.isArray(page.data)
					? page.data.map((post) =>
							post.publicId === postPublicId ? { ...post, likes } : post,
						)
					: page.data,
			})),
		};
	}

	if ("data" in oldData) {
		const regularData = oldData as { data: IPost[] };
		if (Array.isArray(regularData.data)) {
			return {
				...regularData,
				data: regularData.data.map((post) =>
					post.publicId === postPublicId ? { ...post, likes } : post,
				),
			};
		}
	}

	if ("publicId" in oldData) {
		const post = oldData as IPost;
		if (post.publicId === postPublicId) {
			return { ...post, likes };
		}
	}

	return oldData;
};

export const removePostDetailAndCommentCaches = (
	queryClient: QueryClient,
	postPublicId: string,
): void => {
	queryClient.removeQueries({
		predicate: ({ queryKey }) => {
			const key = queryKey as readonly unknown[];
			return (
				(key[0] === "post" && key.includes(postPublicId)) ||
				(key[0] === "comments" && key[1] === "post" && key[2] === postPublicId)
			);
		},
	});
};

export const updatePostLikesInFeedCaches = (
	queryClient: QueryClient,
	postPublicId: string,
	likes: number,
	keys: readonly FeedKey[] = LIKE_CACHE_KEYS,
): void => {
	for (const key of keys) {
		queryClient.setQueriesData({ queryKey: [key] }, (oldData: unknown) =>
			updateLikeCountInCache(oldData, postPublicId, likes),
		);
	}
};

export const updatePostDetailCaches = (
	queryClient: QueryClient,
	postPublicId: string,
	updater: (post: IPost) => IPost,
) => {
	for (const key of [
		["post", "publicId", postPublicId],
		["post", postPublicId],
	] as const) {
		queryClient.setQueriesData<IPost>({ queryKey: key }, (existing) =>
			existing ? updater(existing) : existing,
		);
	}
};

export const updatePostInInfiniteFeeds = (
	queryClient: QueryClient,
	postPublicId: string,
	updater: (post: IPost) => IPost,
	keys: readonly FeedKey[] = REPOST_CACHE_KEYS,
) => {
	for (const key of keys) {
		queryClient.setQueriesData<InfiniteFeed>({ queryKey: [key] }, (existing) => {
			if (!existing) {
				return existing;
			}

			return {
				...existing,
				pages: existing.pages.map((page) => ({
					...page,
					data: page.data.map((post) =>
						post.publicId === postPublicId ? updater(post) : post,
					),
				})),
			};
		});
	}
};
