import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { fetchFeedPreview } from "../../api/postApi";
import type { FeedPreviewDefinition } from "../../features/feed/feedPreview";
import { feedIdentities } from "../../features/feed/feedIdentity";
import { useIsFeedRestoreNavigation } from "../../features/feed/feedRestoration";
import { useAuth } from "../context/useAuth";
import { mapPost } from "../../lib/mappers";

export function useFeedPreview(definition: FeedPreviewDefinition, enabled: boolean) {
  const { user } = useAuth();
  const feedId = feedIdentities.preview(JSON.stringify(definition), user?.publicId);
  const restoring = useIsFeedRestoreNavigation(feedId);
  const queryClient = useQueryClient();
  const queryKey = ["feedPreview", feedId] as const;
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const response = await fetchFeedPreview(definition, pageParam, signal);
      return { ...response, data: response.data.map(mapPost) };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.hasMore ? page.nextCursor : undefined,
    enabled,
    maxPages: 6,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...(restoring ? { refetchOnMount: false } : {}),
  });
  const refreshFeed = async (): Promise<void> => {
    await queryClient.resetQueries({ queryKey, exact: true });
  };
  return { ...query, feedId, refreshFeed };
}
