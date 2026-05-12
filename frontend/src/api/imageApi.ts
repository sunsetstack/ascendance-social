import axiosClient from "./axiosClient";
import { IImage, ITag } from "../types";

export const fetchPersonalizedFeed = async (
  pageParam: number,
  limit: number,
): Promise<{
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(
    `/api/feed?page=${pageParam}&limit=${limit}`,
  );
  return data;
};

export const fetchTrendingFeed = async (
  pageParam: number,
  limit: number = 20,
): Promise<{
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(
    `/api/feed/trending?page=${pageParam}&limit=${limit}`,
  );
  return data;
};

export const fetchNewFeed = async (
  pageParam: number,
  limit: number = 20,
): Promise<{
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(
    `/api/feed/new?page=${pageParam}&limit=${limit}`,
  );
  return data;
};

export const fetchForYouFeed = async (
  pageParam: number,
  limit: number = 20,
): Promise<{
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(
    `/api/feed/for-you?page=${pageParam}&limit=${limit}`,
  );
  return data;
};

export const fetchImages = async (
  pageParam: number,
): Promise<{
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  const { data } = await axiosClient.get(`/api/images?page=${pageParam}`);
  return data;
};

// Get image by public ID
export const fetchImageByPublicId = async (publicId: string) => {
  console.log(`Fetching image by public ID: ${publicId}`);
  const { data } = await axiosClient.get(`/api/images/public/${publicId}`);
  return data;
};

// Get image by slug (SEO-friendly)
export const fetchImageBySlug = async (slug: string) => {
  console.log("Fetching image by slug:", slug);
  const { data } = await axiosClient.get(`/api/images/image/${slug}`);
  return data;
};

export const fetchImagesByTag = async ({
  tags,
  page,
  limit,
}: {
  tags: string[];
  page: number;
  limit: number;
}) => {
  const tagString = tags.join(",");
  const { data } = await axiosClient.get(
    `/api/images/search/tags?tags=${tagString}&page=${page}&limit=${limit}`,
  );
  console.log(data);
  return data;
};

export const uploadImage = async (image: FormData): Promise<IImage> => {
  const response = await axiosClient.post("/api/images/upload", image, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};

export const fetchTags = async (): Promise<ITag[]> => {
  const { data } = await axiosClient.get("/api/images/tags");
  console.log("TAGS:", data);
  return data;
};

// Delete image by public ID
export const deleteImageByPublicId = async (
  publicId: string,
): Promise<void> => {
  console.log("Deleting image with public ID:", publicId);
  await axiosClient.delete(`/api/images/image/${publicId}`);
};
