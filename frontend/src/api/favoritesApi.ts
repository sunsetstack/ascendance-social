import axiosClient from "./axiosClient";
import { IImage } from "../types";

export interface FavoritesResponse {
  data: IImage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const fetchUserFavorites = async (
  page = 1,
  limit = 10,
): Promise<FavoritesResponse> => {
  const { data } = await axiosClient.get(`/api/favorites/user`, {
    params: { page, limit },
  });
  return data;
};

export const addFavorite = async (postPublicId: string): Promise<void> => {
  await axiosClient.post(`/api/favorites/posts/${postPublicId}`);
};

export const removeFavorite = async (postPublicId: string): Promise<void> => {
  await axiosClient.delete(`/api/favorites/posts/${postPublicId}`);
};
