import axiosClient from "./axiosClient";
import { AdminUserDTO, PaginatedResponse, IPost } from "../types";

export interface DashboardStats {
  totalUsers: number;
  totalImages: number;
  bannedUsers: number;
  adminUsers: number;
  recentUsers: number;
  recentImages: number;
  growthRate: {
    users: number;
    images: number;
  };
}

export interface UserStats {
  imageCount: number;
  followerCount: number;
  followingCount: number;
  likeCount: number;
  joinDate: string;
  lastActivity: string;
  lastIp?: string;
}

export interface RecentActivity {
  data: Array<{
    userId: string;
    username: string;
    action: string;
    targetType: string;
    targetId: string;
    timestamp: Date;
  }>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const fetchAllUsersAdmin = async (params: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  startDate?: string;
  endDate?: string;
}): Promise<PaginatedResponse<AdminUserDTO>> => {
  const { data } = await axiosClient.get("/api/admin", { params });
  return data;
};

export const fetchUserAdmin = async (
  publicId: string,
): Promise<AdminUserDTO> => {
  const { data } = await axiosClient.get(`/api/admin/user/${publicId}`);
  return data;
};

export const fetchUserStats = async (publicId: string): Promise<UserStats> => {
  const { data } = await axiosClient.get(`/api/admin/user/${publicId}/stats`);
  return data.stats;
};

export const banUser = async (
  publicId: string,
  reason: string,
): Promise<void> => {
  await axiosClient.put(`/api/admin/user/${publicId}/ban`, { reason });
};

export const unbanUser = async (publicId: string): Promise<void> => {
  await axiosClient.put(`/api/admin/user/${publicId}/unban`);
};

export const promoteToAdmin = async (
  publicId: string,
): Promise<AdminUserDTO> => {
  const { data } = await axiosClient.put(`/api/admin/user/${publicId}/promote`);
  return data;
};

export const demoteFromAdmin = async (
  publicId: string,
): Promise<AdminUserDTO> => {
  const { data } = await axiosClient.put(`/api/admin/user/${publicId}/demote`);
  return data;
};

export const deleteUserAdmin = async (publicId: string): Promise<void> => {
  await axiosClient.delete(`/api/admin/user/${publicId}`);
};

export const fetchAllImagesAdmin = async (params: {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}): Promise<PaginatedResponse<IPost>> => {
  const { data } = await axiosClient.get("/api/admin/images", { params });
  return data;
};

export const deleteImageAdmin = async (publicId: string): Promise<void> => {
  await axiosClient.delete(`/api/admin/image/${publicId}`);
};

export const deleteCommentAdmin = async (commentId: string): Promise<void> => {
  await axiosClient.delete(`/api/admin/comment/${commentId}`);
};

export const removeUserFavoriteAdmin = async (
  userPublicId: string,
  postPublicId: string,
): Promise<void> => {
  await axiosClient.delete(
    `/api/admin/user/${userPublicId}/favorite/${postPublicId}`,
  );
};

export const fetchDashboardStats = async (): Promise<DashboardStats> => {
  const { data } = await axiosClient.get("/api/admin/dashboard/stats");
  return data;
};

export const fetchRecentActivity = async (params: {
  page?: number;
  limit?: number;
}): Promise<RecentActivity> => {
  const { data } = await axiosClient.get("/api/admin/dashboard/activity", {
    params,
  });
  return data;
};

export const clearCache = async (
  pattern?: string,
): Promise<{ message: string; pattern: string; deletedKeys: number }> => {
  const { data } = await axiosClient.delete("/api/admin/cache", {
    params: { pattern: pattern || "all_feeds" },
  });
  return data;
};

export interface TelemetryMetrics {
  ttfi: {
    count: number;
    avg: number;
    p50: number;
    p90: number;
    p99: number;
  };
  scrollDepth: {
    feedId: string;
    avgMaxDepth: number;
    reachedThresholds: Record<number, number>;
  }[];
  flows: {
    flowType: string;
    started: number;
    completed: number;
    abandoned: number;
    completionRate: number;
    avgDuration: number;
  }[];
  bucketAge: number;
}

export const fetchTelemetryMetrics = async (): Promise<TelemetryMetrics> => {
  const { data } = await axiosClient.get("/api/telemetry/summary");
  return data;
};

export interface RequestLog {
  timestamp: Date;
  method: string;
  route: string;
  ip: string;
  origin?: string;
  referer?: string;
  statusCode: number;
  responseTimeMs: number;
  userId?: string;
  userAgent?: string;
  authState?: string;
  authSource?: string;
  authAction?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  refreshRotated?: boolean;
}

export interface RequestLogsResponse {
  data: RequestLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuthActivityLog {
  timestamp: Date;
  action: string;
  ip: string;
  origin?: string;
  referer?: string;
  route?: string;
  statusCode?: number;
  responseTimeMs?: number;
  userId?: string;
  authEmail?: string;
  authUsername?: string;
  authHandle?: string;
  clientRequestId?: string;
  clientBootId?: string;
  clientRequestAttempt?: number;
  axiosRetry?: boolean;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  correlationId?: string;
  authState?: string;
  authSource?: string;
  refreshRotated?: boolean;
}

export interface AuthActivityLogsResponse {
  data: AuthActivityLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const fetchRequestLogs = async (params: {
  page?: number;
  limit?: number;
  userId?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  authState?: string;
  authSource?: string;
  statusCode?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
}): Promise<RequestLogsResponse> => {
  const { data } = await axiosClient.get("/api/admin/dashboard/request-logs", {
    params,
  });
  return data;
};

export const fetchAuthActivityLogs = async (params: {
  page?: number;
  limit?: number;
  userId?: string;
  sessionId?: string;
  tokenFamilyId?: string;
  clientRequestId?: string;
  clientBootId?: string;
  previousClientRequestId?: string;
  causedByClientRequestId?: string;
  authState?: string;
  authSource?: string;
  action?: string;
  statusCode?: number;
  startDate?: string;
  endDate?: string;
  search?: string;
}): Promise<AuthActivityLogsResponse> => {
  const { data } = await axiosClient.get("/api/admin/dashboard/auth-activity", {
    params,
  });
  return data;
};
