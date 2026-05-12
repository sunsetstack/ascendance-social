import axiosClient from "./axiosClient";

export interface TrendingTag {
  tag: string;
  count: number;
  recentPostCount: number;
}

export interface GetTrendingTagsResponse {
  tags: TrendingTag[];
}

export const feedApi = {
  getTrendingTags: async (
    limit: number = 10,
    timeWindowHours: number = 168,
  ): Promise<GetTrendingTagsResponse> => {
    const response = await axiosClient.get("/api/feed/trending-tags", {
      params: { limit, timeWindowHours },
    });
    return response.data;
  },
};
