import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import axiosClient from "../../api/axiosClient";
import type { FeedPreviewPage } from "../../api/postApi";
import { feedIdentities } from "../../features/feed/feedIdentity";
import { useIsFeedRestoreNavigation } from "../../features/feed/feedRestoration";
import { mapPost } from "../../lib/mappers";
import { useAuth } from "../context/useAuth";

export function useInterestFeed(topic: string, sort: string, enabled: boolean) {
  const { user } = useAuth();
  const client = useQueryClient();
  const feedId = feedIdentities.preview(`interests:${topic}:${sort}`, user?.publicId);
  const restoring = useIsFeedRestoreNavigation(feedId);
  const queryKey = ["interestFeed", feedId] as const;
  const query = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ topics: topic, sort, limit: "10" });
      if (pageParam) params.set("cursor", pageParam);
      const { data } = await axiosClient.get<FeedPreviewPage>(`/api/feed/interests/posts?${params}`, { signal });
      return { ...data, data: data.data.map(mapPost) };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.hasMore ? page.nextCursor : undefined,
    enabled,
    maxPages: 6,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...(restoring ? { refetchOnMount: false } : {}),
  });
  return { ...query, feedId, refreshFeed: () => client.resetQueries({ queryKey, exact: true }) };
}
