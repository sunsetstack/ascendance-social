import { IPost, IUser, ICommunity } from "../types";
import axiosClient from "./axiosClient";

export const searchQuery = async (
  query: string,
): Promise<{
  success: boolean;
  data: {
    users: IUser[] | null;
    posts: IPost[] | null;
    communities: ICommunity[] | null;
  };
}> => {
  const { data } = await axiosClient.get(
    `/api/search?q=${encodeURIComponent(query)}`,
  );
  return data;
};
