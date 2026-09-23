import {
  useMutation,
  useQuery,
  useQueryClient,
  UseQueryOptions,
  InfiniteData,
  QueryKey,
} from "@tanstack/react-query";
import { followUser, likePost } from "../../api/userActions";
import { fetchIsFollowing } from "../../api/userApi";
import { addFavorite, removeFavorite } from "../../api/favoritesApi";
import {
  IPost,
  ImagePageData,
  PublicUserDTO,
  AuthenticatedUserDTO,
  AdminUserDTO,
  WhoToFollowResponse,
} from "../../types";
import { devError } from "@/lib/devLogger";
import { postInteractionQueryFilter, updatePostInCache } from "../posts/postCache";

/**All hooks use public ids */
export const useFollowUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: followUser,
    onMutate: async (publicId) => {
      const userEntries = queryClient.getQueriesData<PublicUserDTO>({
        queryKey: ["user"],
      });
      const whoToFollowEntries =
        queryClient.getQueriesData<WhoToFollowResponse>({
          queryKey: ["whoToFollow"],
        });
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: ["isFollowing", publicId],
          exact: true,
        }),
        queryClient.cancelQueries({
          queryKey: ["userPosts", publicId],
          exact: true,
        }),
        queryClient.cancelQueries({ queryKey: ["currentUser"], exact: true }),
        ...userEntries.map(([key]) =>
          queryClient.cancelQueries({ queryKey: key }),
        ),
        ...whoToFollowEntries.map(([key]) =>
          queryClient.cancelQueries({ queryKey: key }),
        ),
      ]);

      const previousIsFollowing = queryClient.getQueryData<boolean>([
        "isFollowing",
        publicId,
      ]);
      const previousUserPosts = queryClient.getQueryData<
        InfiniteData<ImagePageData>
      >(["userPosts", publicId]);
      const previousCurrentUser = queryClient.getQueryData<
        AuthenticatedUserDTO | AdminUserDTO
      >(["currentUser"]);

      const wasFollowing = previousIsFollowing ?? false;
      const delta = wasFollowing ? -1 : 1;
      const nextIsFollowing = !wasFollowing;

      queryClient.setQueryData(["isFollowing", publicId], nextIsFollowing);

      userEntries.forEach(([key, data]) => {
        if (!data || data.publicId !== publicId) {
          return;
        }
        queryClient.setQueryData<PublicUserDTO>(key, {
          ...data,
          followerCount: Math.max(0, data.followerCount + delta),
        });
      });

      if (previousUserPosts) {
        const updatedPages = previousUserPosts.pages.map((page) => {
          if (!page?.profile || page.profile.publicId !== publicId) {
            return page;
          }
          return {
            ...page,
            profile: {
              ...page.profile,
              followerCount: Math.max(0, page.profile.followerCount + delta),
            },
          };
        });
        queryClient.setQueryData<InfiniteData<ImagePageData>>(
          ["userPosts", publicId],
          {
            ...previousUserPosts,
            pages: updatedPages,
          },
        );
      }

      if (previousCurrentUser) {
        queryClient.setQueryData<AuthenticatedUserDTO | AdminUserDTO>(
          ["currentUser"],
          {
            ...previousCurrentUser,
            followingCount: Math.max(
              0,
              previousCurrentUser.followingCount + delta,
            ),
          },
        );
      }

      whoToFollowEntries.forEach(([key, data]) => {
        if (!data) {
          return;
        }
        if (delta > 0) {
          const filtered = data.suggestions.filter(
            (suggestion) => suggestion.publicId !== publicId,
          );
          queryClient.setQueryData<WhoToFollowResponse>(key, {
            ...data,
            suggestions: filtered,
          });
        } else if (delta < 0) {
          const suggestions = data.suggestions.map((suggestion) =>
            suggestion.publicId === publicId
              ? {
                  ...suggestion,
                  followerCount: Math.max(0, suggestion.followerCount + delta),
                }
              : suggestion,
          );
          queryClient.setQueryData<WhoToFollowResponse>(key, {
            ...data,
            suggestions,
          });
        }
      });

      return {
        previousIsFollowing,
        previousUserEntries: userEntries,
        previousUserPosts,
        previousCurrentUser,
        previousWhoToFollowEntries: whoToFollowEntries,
        publicId,
      };
    },
    onSuccess: (_data, publicId) => {
      queryClient.invalidateQueries({
        queryKey: ["isFollowing", publicId],
        exact: true,
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: ["user"],
        refetchType: "inactive",
        predicate: (query) => {
          const cached = query.state.data as
            | PublicUserDTO
            | AuthenticatedUserDTO
            | AdminUserDTO
            | undefined;
          return cached?.publicId === publicId;
        },
      });
      queryClient.invalidateQueries({
        queryKey: ["userPosts", publicId],
        exact: true,
        refetchType: "inactive",
      });
      queryClient.invalidateQueries({
        queryKey: ["currentUser"],
        exact: true,
        refetchType: "inactive",
      });
      queryClient.invalidateQueries({
        queryKey: ["whoToFollow"],
        refetchType: "active",
      });
    },
    onError: (error: Error, publicId, context) => {
      devError("Error following user:", error.message || error);
      if (!context) {
        return;
      }
      queryClient.setQueryData(
        ["isFollowing", publicId],
        context.previousIsFollowing,
      );
      context.previousUserEntries.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
      if (context.previousUserPosts) {
        queryClient.setQueryData(
          ["userPosts", publicId],
          context.previousUserPosts,
        );
      }
      if (context.previousCurrentUser !== undefined) {
        queryClient.setQueryData(["currentUser"], context.previousCurrentUser);
      }
      context.previousWhoToFollowEntries.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
  });
};

export const useFavoritePost = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      publicId,
      shouldFavorite,
    }: {
      publicId: string;
      shouldFavorite: boolean;
    }) => {
      if (shouldFavorite) {
        await addFavorite(publicId);
      } else {
        await removeFavorite(publicId);
      }
    },
    onMutate: async ({ publicId, shouldFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ["post", publicId] });

      const previousPost = queryClient.getQueryData<IPost>(["post", publicId]);

      queryClient.setQueryData<IPost>(["post", publicId], (old) =>
        old ? { ...old, isFavoritedByViewer: shouldFavorite } : old,
      );

      return { previousPost, publicId };
    },
    onError: (_err, { publicId }, context) => {
      if (context?.previousPost) {
        queryClient.setQueryData(["post", publicId], context.previousPost);
      }
    },
    onSuccess: () => {
      // Don't invalidate immediately - trust the optimistic update
      // Only mark favorites list as stale in background
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ["favorites", "user"],
          refetchType: "none",
        });
      }, 1000);
    },
  });
};

export const useLikePost = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: likePost,
    onMutate: async (postPublicId) => {
      await queryClient.cancelQueries(postInteractionQueryFilter);
      const previousPosts: Array<{ queryKey: QueryKey; post: IPost }> = [];
      for (const [queryKey, data] of queryClient.getQueriesData(
        postInteractionQueryFilter,
      )) {
        let previousPost: IPost | undefined;
        updatePostInCache(data, postPublicId, (post) => {
          previousPost ??= post;
          return post;
        });
        if (previousPost) previousPosts.push({ queryKey, post: previousPost });
      }

      const detail = queryClient.getQueryData<IPost>(["post", postPublicId]);
      const shouldLike = !(detail ?? previousPosts[0]?.post)?.isLikedByViewer;
      queryClient.setQueriesData(postInteractionQueryFilter, (data: unknown) =>
        updatePostInCache(data, postPublicId, (post) => ({
          ...post,
          likes: Math.max(
            0,
            post.likes + Number(shouldLike) - Number(!!post.isLikedByViewer),
          ),
          isLikedByViewer: shouldLike,
        })),
      );
      return { previousPosts };
    },
    onError: (_error, postPublicId, context) => {
      for (const { queryKey, post: previous } of context?.previousPosts ?? []) {
        queryClient.setQueryData(queryKey, (data: unknown) =>
          updatePostInCache(data, postPublicId, (post) => ({
            ...post,
            likes: previous.likes,
            isLikedByViewer: previous.isLikedByViewer,
          })),
        );
      }
    },
    onSettled: () => {
      return queryClient.invalidateQueries({
        ...postInteractionQueryFilter,
        refetchType: "none",
      });
    },
  });
};

// Legacy alias for backward compatibility
export const useLikeImage = useLikePost;

// Check if current LOGGED IN user is following the profile they're visiting by publicid
export const useIsFollowing = (
  publicId: string,
  options?: Omit<
    UseQueryOptions<boolean, Error, boolean>,
    "queryKey" | "queryFn"
  >,
) => {
  return useQuery({
    queryKey: ["isFollowing", publicId],
    queryFn: () => fetchIsFollowing({ queryKey: ["isFollowing", publicId] }),
    staleTime: 6000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !!publicId, // Only run if publicId is provided
    ...options,
  });
};
