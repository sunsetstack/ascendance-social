import axiosClient from "./axiosClient";
import {
  ImagePageData,
  PublicUserDTO,
  AuthenticatedUserDTO,
  AdminUserDTO,
  AccountInfoDTO,
  WhoToFollowResponse,
  IComment,
  HandleSuggestionResponse,
  HandleSuggestionContext,
} from "../types";
import axios, { AxiosError } from "axios";
import { devError } from "@/lib/devLogger";

export type LoginResponse = { user: AuthenticatedUserDTO | AdminUserDTO };
export type RegisterResponse = { user: AuthenticatedUserDTO };

// Login returns authenticated user (tokens are stored in httpOnly cookies)
export const loginRequest = async (credentials: {
  email: string;
  password: string;
}): Promise<LoginResponse> => {
  const response = await axiosClient.post("/api/users/login", credentials);
  return response.data;
};

// Register returns authenticated user (tokens are stored in httpOnly cookies)
export const registerRequest = async (credentials: {
  handle: string;
  username: string;
  email: string;
  password: string;
}): Promise<RegisterResponse> => {
  const response = await axiosClient.post("/api/users/register", credentials);
  return response.data;
};

// Check if following using public ID
export const fetchIsFollowing = async ({
  queryKey,
}: {
  queryKey: [string, string];
}): Promise<boolean> => {
  const [, publicId] = queryKey;
  const { data } = await axiosClient.get(`/api/users/follows/${publicId}`);
  return data.isFollowing;
};

// Get current user at /me
export const fetchCurrentUser = async (
  signal?: AbortSignal,
): Promise<AuthenticatedUserDTO | AdminUserDTO | null> => {
  try {
    const { data } = await axiosClient.get<AuthenticatedUserDTO | AdminUserDTO>(
      "/api/users/me",
      { signal },
    );
    return data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const info = {
        status,
        url: "/api/users/me",
        message: err.message,
        code: err.code,
      };
      if (status === 401 || status === 403) {
        // User is not logged in - return null instead of throwing
        return null;
      }
      throw Object.assign(err, info);
    }
    throw err as AxiosError;
  }
};

export const fetchUserByPublicId = async ({
  queryKey,
}: {
  queryKey: [string, string];
}): Promise<PublicUserDTO> => {
  const [, publicId] = queryKey;
  const response = await axiosClient.get(`/api/users/public/${publicId}`);
  return response.data;
};

export const fetchUserByHandle = async ({
  queryKey,
}: {
  queryKey: [string, string];
}): Promise<PublicUserDTO> => {
  const [, handle] = queryKey;
  const response = await axiosClient.get(`/api/users/profile/${handle}`);
  return response.data;
};

export const fetchUserPosts = async (
  page: number,
  userPublicId: string,
  limit: number = 10,
  sortBy: string = "createdAt",
  sortOrder: string = "desc",
): Promise<ImagePageData> => {
  try {
    const { data } = await axiosClient.get(
      `/api/posts/user/${userPublicId}?page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
    );
    return data;
  } catch (error) {
    devError("Error fetching user posts:", error);
    throw error;
  }
};

export const fetchUserLikedPosts = async (
  page: number,
  userPublicId: string,
  limit: number = 10,
  sortBy: string = "createdAt",
  sortOrder: string = "desc",
): Promise<ImagePageData> => {
  try {
    const { data } = await axiosClient.get(
      `/api/posts/user/${userPublicId}/likes?page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
    );
    return data;
  } catch (error) {
    devError("Error fetching user liked posts:", error);
    throw error;
  }
};

export const fetchUserComments = async (
  page: number,
  userPublicId: string,
  limit: number = 10,
  sortBy: string = "createdAt",
  sortOrder: string = "desc",
): Promise<{
  comments: IComment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> => {
  try {
    const { data } = await axiosClient.get(
      `/api/users/${userPublicId}/comments?page=${page}&limit=${limit}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
    );
    return data;
  } catch (error) {
    devError("Error fetching user comments:", error);
    throw error;
  }
};

export const updateUserAvatar = async (
  avatar: Blob,
): Promise<AuthenticatedUserDTO | AdminUserDTO> => {
  const formData = new FormData();
  formData.append(
    "avatar",
    avatar,
    `avatar.${avatar.type.split("/")[1] || "png"}`,
  );

  const { data } = await axiosClient.put("/api/users/me/avatar", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
};

export const updateUserCover = async (
  cover: Blob,
): Promise<AuthenticatedUserDTO | AdminUserDTO> => {
  const formData = new FormData();
  formData.append("cover", cover, `cover.${cover.type.split("/")[1] || "png"}`);

  const { data } = await axiosClient.put("/api/users/me/cover", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return data;
};

export const editUserRequest = async (updateData: {
  username?: string;
  bio?: string;
}): Promise<AuthenticatedUserDTO | AdminUserDTO> => {
  const response = await axiosClient.put("/api/users/me/edit", updateData);
  return response.data;
};

export const changePasswordRequest = async (passwords: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> => {
  await axiosClient.put("/api/users/me/change-password", passwords);
};

export const fetchAccountInfo = async (): Promise<AccountInfoDTO> => {
  const { data } = await axiosClient.get<AccountInfoDTO>(
    "/api/users/me/account-info",
  );
  return data;
};

export const deleteAccountRequest = async (password: string): Promise<void> => {
  await axiosClient.delete("/api/users/me", { data: { password } });
};

export const fetchWhoToFollow = async (
  limit: number = 5,
): Promise<WhoToFollowResponse> => {
  const { data } = await axiosClient.get(
    `/api/users/suggestions/who-to-follow?limit=${limit}`,
  );
  return data;
};

export const fetchHandleSuggestions = async (
  query: string,
  context: HandleSuggestionContext,
  limit: number = 8,
): Promise<HandleSuggestionResponse> => {
  const { data } = await axiosClient.get("/api/users/suggestions/handles", {
    params: { q: query, context, limit },
  });
  return data;
};

export interface FollowUserItem {
  publicId: string;
  handle: string;
  username: string;
  avatar: string;
  bio?: string;
}

export interface FollowListResponse {
  users: FollowUserItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const fetchFollowers = async (
  userPublicId: string,
  page: number = 1,
  limit: number = 20,
): Promise<FollowListResponse> => {
  const { data } = await axiosClient.get(
    `/api/users/${userPublicId}/followers?page=${page}&limit=${limit}`,
  );
  return data;
};

export const fetchFollowing = async (
  userPublicId: string,
  page: number = 1,
  limit: number = 20,
): Promise<FollowListResponse> => {
  const { data } = await axiosClient.get(
    `/api/users/${userPublicId}/following?page=${page}&limit=${limit}`,
  );
  return data;
};

export const requestPasswordReset = async (payload: {
  email: string;
}): Promise<void> => {
  await axiosClient.post("/api/users/forgot-password", payload);
};

export const resetPassword = async (payload: {
  token: string;
  newPassword: string;
}): Promise<void> => {
  await axiosClient.post("/api/users/reset-password", payload);
};

export const verifyEmail = async (payload: {
  email: string;
  token: string;
}): Promise<AuthenticatedUserDTO | AdminUserDTO> => {
  const response = await axiosClient.post("/api/users/verify-email", payload);
  return response.data;
};
