import axiosClient from "./axiosClient";
import { IPost, ITag, PaginatedResponse } from "../types";

export const fetchPersonalizedFeed = async (
  pageParam: number | string,
  limit: number,
): Promise<PaginatedResponse<IPost>> => {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (typeof pageParam === "string") {
    params.set("cursor", pageParam);
  } else {
    params.set("page", String(pageParam));
  }
  const { data } = await axiosClient.get(`/api/feed?${params.toString()}`);
  return data;
};

export const fetchTrendingFeed = async (
  pageParam: number | string,
  limit: number = 20,
): Promise<PaginatedResponse<IPost>> => {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (typeof pageParam === "string") {
    params.set("cursor", pageParam);
  } else {
    params.set("page", String(pageParam));
  }
  const { data } = await axiosClient.get(
    `/api/feed/trending?${params.toString()}`,
  );
  return data;
};

export const fetchNewFeed = async (
  pageParam: number | string,
  limit: number = 20,
  refresh: boolean = false,
): Promise<PaginatedResponse<IPost>> => {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (typeof pageParam === "string") {
    params.set("cursor", pageParam);
  } else {
    params.set("page", String(pageParam));
  }
  if (refresh) {
    params.set("refresh", "true");
  }
  const { data } = await axiosClient.get(`/api/feed/new?${params.toString()}`);
  return data;
};

export const fetchForYouFeed = async (
  pageParam: number | string,
  limit: number = 20,
): Promise<PaginatedResponse<IPost>> => {
  const params = new URLSearchParams({
    limit: String(limit),
  });
  if (typeof pageParam === "string") {
    params.set("cursor", pageParam);
  } else {
    params.set("page", String(pageParam));
  }
  const { data } = await axiosClient.get(
    `/api/feed/for-you?${params.toString()}`,
  );
  return data;
};

export const fetchPosts = async (
  pageParam: number,
  limit: number = 10,
): Promise<{
  data: IPost[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(
    `/api/posts/?page=${pageParam}&limit=${limit}`,
  );
  return data;
};

export const fetchPostByPublicId = async (publicId: string) => {
  const { data } = await axiosClient.get(`/api/posts/${publicId}`);
  return data;
};

export const fetchPostBySlug = async (slug: string) => {
  const { data } = await axiosClient.get(`/api/posts/slug/${slug}`);
  return data;
};

export const fetchPostsByTag = async ({
  tags,
  page,
  limit,
}: {
  tags: string[];
  page: number;
  limit: number;
}) => {
  const tagString = tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .join(",");

  if (!tagString) {
    return {
      data: [],
      total: 0,
      page,
      limit,
      totalPages: 0,
    };
  }
  const { data } = await axiosClient.get(
    `/api/posts/search/tags?tags=${tagString}&page=${page}&limit=${limit}`,
  );
  return data;
};

export const uploadPost = async (post: FormData): Promise<IPost> => {
  const response = await axiosClient.post("/api/posts", post, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const fetchTags = async (): Promise<ITag[]> => {
  const { data } = await axiosClient.get("/api/posts/tags");
  console.log("TAGS:", data);
  return data;
};

export const deletePostByPublicId = async (publicId: string): Promise<void> => {
  console.log("Deleting post with public ID:", publicId);
  await axiosClient.delete(`/api/posts/${publicId}`);
};

export const repostPost = async (
  postPublicId: string,
  body?: string,
): Promise<IPost> => {
  const payload = body ? { body } : {};
  const { data } = await axiosClient.post(
    `/api/posts/${postPublicId}/repost`,
    payload,
  );
  return data;
};

export const unrepostPost = async (postPublicId: string): Promise<void> => {
  await axiosClient.delete(`/api/posts/${postPublicId}/repost`);
};

export const fetchPostsByCommunity = async (
  communityId: string,
  pageParam: number,
  limit: number = 20,
): Promise<{
  data: IPost[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(
    `/api/communities/${communityId}/feed?page=${pageParam}&limit=${limit}`,
  );
  return data;
};
