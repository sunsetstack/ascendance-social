import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchPostByPublicId,
  fetchPostBySlug,
  uploadPost,
  fetchTags,
  fetchPostsByTag,
  deletePostByPublicId,
  fetchPersonalizedFeed,
  fetchTrendingFeed,
  fetchNewFeed,
  fetchForYouFeed,
  repostPost,
  unrepostPost,
} from "../../api/postApi";
import { IPost, ITag, PaginatedResponse } from "../../types";
import { useAuth } from "../context/useAuth";
import { mapPost } from "../../lib/mappers";
import { devError } from "@/lib/devLogger";
import {
	removePostFromFeedCaches,
	updatePostDetailCaches,
	updatePostInInfiniteFeeds,
	refreshFirstFeedPage,
} from "./postCache";
import { feedIdentities } from "../../features/feed/feedIdentity";
import { useIsFeedRestoreNavigation } from "../../features/feed/feedRestoration";

const MAX_FEED_PAGES = 6;
const FEED_PAGE_SIZE = 5;
const HOME_FEED_GC_TIME = 5 * 60 * 1000;

export const usePosts = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const homeFeedId = feedIdentities.home(user?.publicId);
  const isRestoreNavigation = useIsFeedRestoreNavigation(homeFeedId);

  const queryKey = ["posts", user?.publicId];

  const query = useInfiniteQuery<PaginatedResponse<IPost>, Error>({
    queryKey,
    queryFn: async ({ pageParam = 1 }) => {
      const response = !user
        ? await fetchNewFeed(pageParam as number | string, FEED_PAGE_SIZE)
        : await fetchPersonalizedFeed(pageParam as number | string, FEED_PAGE_SIZE);

      return {
        ...response,
        data: response.data.map((rawPost: IPost) => mapPost(rawPost)),
      };
    },
    getNextPageParam: (lastPage) => {
      // cursor-based feeds: check hasMore first
      if (lastPage.hasMore === false) return undefined;
      if (lastPage.nextCursor) return lastPage.nextCursor;
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    maxPages: MAX_FEED_PAGES,
    staleTime: 0,
    gcTime: HOME_FEED_GC_TIME,
    ...(isRestoreNavigation ? { refetchOnMount: false } : {}),
  });
  const refreshFeed = () => refreshFirstFeedPage(queryClient, queryKey, () =>
    user
      ? fetchPersonalizedFeed(1, FEED_PAGE_SIZE)
      : fetchNewFeed(1, FEED_PAGE_SIZE),
  );
  return { ...query, refreshFeed };
};

export const usePostByPublicId = (publicId: string) => {
  const { user } = useAuth();

  return useQuery<IPost, Error>({
    queryKey: ["post", "publicId", publicId, user?.publicId],
    queryFn: async () => {
      const rawPost = await fetchPostByPublicId(publicId);
      return mapPost(rawPost);
    },
    enabled: !!publicId,
    staleTime: 0,
    refetchOnMount: true,
  });
};

export const usePostBySlug = (slug: string) => {
  return useQuery<IPost, Error>({
    queryKey: ["post", "slug", slug],
    queryFn: async () => {
      const rawPost = await fetchPostBySlug(slug);
      return mapPost(rawPost);
    },
    enabled: !!slug,
    staleTime: 0,
    refetchOnMount: true,
  });
};

export const usePostById = (identifier: string) => {
  // Strip file extension
  const cleanIdentifier = identifier
    ? identifier.replace(/\.(png|jpg|jpeg|gif|webp)$/i, "")
    : identifier;

  return useQuery<IPost, Error>({
    queryKey: ["post", cleanIdentifier],
    queryFn: async () => {
      const rawPost = await fetchPostByPublicId(cleanIdentifier);
      const mappedPost = mapPost(rawPost);
      return mappedPost;
    },
    enabled: !!identifier,
    staleTime: 0,
    refetchOnMount: true,
  });
};

export const usePostsByTag = (
  tags: string[],
  options?: {
    limit?: number;
    enabled?: boolean;
  },
) => {
  const { user } = useAuth();
  const limit = options?.limit ?? 10;
  const enabled = options?.enabled ?? tags.length > 0;
  const feedId = feedIdentities.search("tags", tags.join(","), user?.publicId);
  const isRestoreNavigation = useIsFeedRestoreNavigation(feedId);

  return useInfiniteQuery<
    {
      data: IPost[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    },
    Error
  >({
    queryKey: ["postsByTag", tags, limit, feedId],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetchPostsByTag({
        tags,
        page: pageParam as number,
        limit,
      });
      return {
        ...response,
        data: response.data.map((rawPost: IPost) => mapPost(rawPost)),
      };
    },
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
    initialPageParam: 1,
    maxPages: MAX_FEED_PAGES,
    enabled,
    staleTime: 0,
    ...options,
    refetchOnMount: isRestoreNavigation ? false : true,
  });
};

export const useTags = () => {
  return useQuery<ITag[], Error>({
    queryKey: ["tags"],
    queryFn: fetchTags,
    staleTime: 0,
    refetchOnMount: true,
  });
};

export const useUploadPost = () => {
  const queryClient = useQueryClient();

  return useMutation<IPost, Error, FormData>({
    mutationFn: uploadPost,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["currentUser"] });

      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["post"] });
      queryClient.invalidateQueries({ queryKey: ["user"] });
      queryClient.invalidateQueries({ queryKey: ["userPosts"] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
    },
    onError: (error: Error) => {
      devError("Error uploading post:", error);
    },
  });
};

export const useDeletePost = () => {
  const queryClient = useQueryClient();

  return useMutation<void, Error, string>({
    mutationFn: deletePostByPublicId,
    onSuccess: (_data, publicId) => {
      removePostFromFeedCaches(queryClient, publicId);

      // Remove the post detail and comments from cache immediately so they cannot
      // be background-refetched while PostView is still mounted.
      queryClient.removeQueries({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return (
            (key[0] === "post" && key.includes(publicId)) ||
            (key[0] === "comments" && key[1] === "post" && key[2] === publicId)
          );
        },
      });

      // Broader invalidations for counts / profile data
      queryClient.invalidateQueries({ queryKey: ["user"] });
      queryClient.invalidateQueries({ queryKey: ["userPosts"] });
      queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
    },
    onError: (error: Error) => {
      devError("Error deleting post:", error);
    },
  });
};

export const useRepostPost = () => {
  const queryClient = useQueryClient();

  return useMutation<IPost, Error, { postPublicId: string; body?: string }>({
    mutationFn: ({ postPublicId, body }) => repostPost(postPublicId, body),
    onSuccess: (_newPost, { postPublicId }) => {
      const applyRepostState = (post: IPost): IPost => ({
        ...post,
        repostCount: (post.repostCount || 0) + 1,
        isRepostedByViewer: true,
      });

      updatePostDetailCaches(queryClient, postPublicId, applyRepostState);
      updatePostInInfiniteFeeds(queryClient, postPublicId, applyRepostState);

      queryClient.invalidateQueries({
        queryKey: ["post", "publicId", postPublicId],
      });
      queryClient.invalidateQueries({ queryKey: ["post", postPublicId] });

      // Invalidate feeds to show the new repost
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
      queryClient.invalidateQueries({ queryKey: ["newFeed"] });
      queryClient.invalidateQueries({ queryKey: ["forYouFeed"] });
      queryClient.invalidateQueries({ queryKey: ["userPosts"] });
    },
    onError: (error: Error) => {
      devError("Error reposting post:", error);
    },
  });
};

export const useUnrepostPost = () => {
  const queryClient = useQueryClient();

  return useMutation<void, Error, { postPublicId: string }>({
    mutationFn: ({ postPublicId }) => unrepostPost(postPublicId),
    onSuccess: (_result, { postPublicId }) => {
      const clearRepostState = (post: IPost): IPost => ({
        ...post,
        repostCount: Math.max((post.repostCount || 0) - 1, 0),
        isRepostedByViewer: false,
      });

      updatePostDetailCaches(queryClient, postPublicId, clearRepostState);
      updatePostInInfiniteFeeds(queryClient, postPublicId, clearRepostState);

      queryClient.invalidateQueries({
        queryKey: ["post", "publicId", postPublicId],
      });
      queryClient.invalidateQueries({ queryKey: ["post", postPublicId] });

      // Invalidate feeds to remove the repost
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
      queryClient.invalidateQueries({ queryKey: ["newFeed"] });
      queryClient.invalidateQueries({ queryKey: ["forYouFeed"] });
      queryClient.invalidateQueries({ queryKey: ["userPosts"] });
    },
    onError: (error: Error) => {
      devError("Error removing repost:", error);
    },
  });
};

export const usePersonalizedFeed = (options?: {
  enabled?: boolean;
  limit?: number;
}) => {
  const { isLoggedIn } = useAuth();
  const enabled = options?.enabled ?? isLoggedIn;
  const limit = options?.limit ?? 5;

  return useInfiniteQuery<PaginatedResponse<IPost>, Error>({
    queryKey: ["personalizedFeed"],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetchPersonalizedFeed(
        pageParam as number | string,
        limit,
      );
      return {
        ...response,
        data: response.data.map((rawPost: IPost) => mapPost(rawPost)),
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore === false) return undefined;
      if (lastPage.nextCursor) return lastPage.nextCursor;
      return undefined;
    },
    initialPageParam: 1,
    maxPages: MAX_FEED_PAGES,
    enabled,
    staleTime: 0,
  });
};

export const useTrendingFeed = (options?: {
  enabled?: boolean;
  limit?: number;
}) => {
  const { user } = useAuth();
  const enabled = options?.enabled ?? true;
  const limit = options?.limit ?? 10;
  const feedId = feedIdentities.trending(user?.publicId);
  const isRestoreNavigation = useIsFeedRestoreNavigation(feedId);
  const queryClient = useQueryClient();
  const queryKey = ["trendingFeed", feedId, limit] as const;

  const query = useInfiniteQuery<PaginatedResponse<IPost>, Error>({
    queryKey,
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetchTrendingFeed(
        pageParam as number | string,
        limit,
      );
      return {
        ...response,
        data: response.data.map(mapPost),
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore === false) return undefined;
      if (lastPage.nextCursor) return lastPage.nextCursor;
      return undefined;
    },
    initialPageParam: 1,
    maxPages: MAX_FEED_PAGES,
    enabled,
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...(isRestoreNavigation ? { refetchOnMount: false } : {}),
  });
  const refreshFeed = () => refreshFirstFeedPage(queryClient, queryKey, () =>
    fetchTrendingFeed(1, limit),
  );
  return { ...query, refreshFeed };
};

export const useNewFeed = (options?: { enabled?: boolean; limit?: number }) => {
  const { user } = useAuth();
  const enabled = options?.enabled ?? true;
  const limit = options?.limit ?? 10;
  const feedId = feedIdentities.latest(user?.publicId);
  const isRestoreNavigation = useIsFeedRestoreNavigation(feedId);
  const queryClient = useQueryClient();
  const queryKey = ["newFeed", feedId, limit] as const;

  const query = useInfiniteQuery<PaginatedResponse<IPost>, Error>({
    queryKey,
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetchNewFeed(pageParam as number | string, limit);
      return {
        ...response,
        data: response.data.map(mapPost),
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore === false) return undefined;
      if (lastPage.nextCursor) return lastPage.nextCursor;
      return undefined;
    },
    initialPageParam: 1,
    maxPages: MAX_FEED_PAGES,
    enabled,
    staleTime: 5 * 60 * 1000,
    ...(isRestoreNavigation ? { refetchOnMount: false } : {}),
  });

  // manual refresh that bypasses cache (for authenticated users)
  const refreshFeed = async () => {
    await queryClient.cancelQueries({ queryKey, exact: true });
    const currentFeed = queryClient.getQueryData<
      InfiniteData<PaginatedResponse<IPost>>
    >(queryKey);
    let cursor = currentFeed?.pages[0]?.prevCursor;
    // An empty feed has no head from which to request a delta.
    if (!user || !cursor) {
      return refreshFirstFeedPage(queryClient, queryKey, async () => {
        const firstPage = await fetchNewFeed(1, limit);
        return user && firstPage.data.length === 0
          ? fetchNewFeed(1, limit, true)
          : firstPage;
      });
    }
    let response: PaginatedResponse<IPost>;
    let headCursor = cursor;
    const deltaPages: IPost[][] = [];
    do {
      response = await fetchNewFeed(cursor, limit, true);
      deltaPages.push(response.data.map(mapPost));
      headCursor = response.prevCursor ?? headCursor;
      cursor = response.nextCursor;
    } while (response.hasMore && cursor);
    const refreshedPage = {
      ...response,
      prevCursor: headCursor,
      data: deltaPages.reverse().flat(),
    };
    await queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData<InfiniteData<PaginatedResponse<IPost>>>(
      queryKey,
      (current) => {
        if (!current?.pages.length) return current;

        const existingIds = new Set(
          current.pages.flatMap((page) =>
            page.data.map((post) => post.publicId),
          ),
        );
        const newPosts = refreshedPage.data.filter(
          (post) => !existingIds.has(post.publicId),
        );
        if (newPosts.length === 0) return current;

        const [firstPage, ...remainingPages] = current.pages;
        return {
          ...current,
          pageParams: [1, ...current.pageParams.slice(1)],
          pages: [
            {
              ...firstPage,
              data: [...newPosts, ...firstPage.data],
              prevCursor: refreshedPage.prevCursor,
            },
            ...remainingPages,
          ],
        };
      },
    );
    return refreshedPage;
  };

  return { ...query, refreshFeed };
};

export const useForYouFeed = (options?: {
  enabled?: boolean;
  limit?: number;
}) => {
  const { isLoggedIn, user } = useAuth();
  const enabled = options?.enabled ?? isLoggedIn;
  const limit = options?.limit ?? 10;
  const feedId = feedIdentities.forYou(user?.publicId);
  const isRestoreNavigation = useIsFeedRestoreNavigation(feedId);
  const queryClient = useQueryClient();
  const queryKey = ["forYouFeed", feedId, limit] as const;

  const query = useInfiniteQuery<PaginatedResponse<IPost>, Error>({
    queryKey,
    queryFn: async ({ pageParam = 1 }) => {
      const response = await fetchForYouFeed(
        pageParam as number | string,
        limit,
      );
      return {
        ...response,
        data: response.data.map(mapPost),
      };
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.hasMore === false) return undefined;
      if (lastPage.nextCursor) return lastPage.nextCursor;
      return undefined;
    },
    initialPageParam: 1,
    maxPages: MAX_FEED_PAGES,
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...(isRestoreNavigation ? { refetchOnMount: false } : {}),
  });
  const refreshFeed = () => refreshFirstFeedPage(queryClient, queryKey, () =>
    fetchForYouFeed(1, limit),
  );
  return { ...query, refreshFeed };
};
