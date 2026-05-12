import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { devWarn } from "@/lib/devLogger";

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const AUTH_BYPASS_ENDPOINTS = [
  "/api/users/login",
  "/api/users/register",
  "/api/users/refresh",
  "/api/users/logout",
];

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

let refreshPromise: Promise<void> | null = null;

const shouldBypassRefresh = (url?: string): boolean => {
  if (!url) return false;
  // After account deletion the page reloads with no session; suppress the
  // one-shot refresh attempt that would otherwise fire on GET /api/users/me.
  if (sessionStorage.getItem("account_deleted") === "1") {
    sessionStorage.removeItem("account_deleted");
    return true;
  }
  return AUTH_BYPASS_ENDPOINTS.some((endpoint) => url.includes(endpoint));
};

const refreshAccessSession = async (): Promise<void> => {
  await axiosClient.post("/api/users/refresh");
};

export default axiosClient;

// Global response interceptor to catch auth expiry
axiosClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status;
    const rawMessage = error.response?.data?.message;

    // Extract the backend error message if available
    if (rawMessage) {
      error.message = rawMessage;
    }

    if (typeof error.message === "string") {
      const sanitized = error.message
        .replace(/\bUoW\b/gi, "transaction")
        .replace(/\btransaction\b/gi, "request")
        .replace(/internal server error/gi, "something went wrong")
        .replace(/error\s*\d+/gi, "error")
        .replace(/\bDatabase\b/gi, "service")
        .replace(/\bMongoDB\b/gi, "service");
      error.message = sanitized;
    }

    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const shouldRefresh =
      status === 401 &&
      Boolean(originalRequest) &&
      !originalRequest?._retry &&
      !shouldBypassRefresh(originalRequest?.url);

    if (shouldRefresh && originalRequest) {
      originalRequest._retry = true;

      if (!refreshPromise) {
        refreshPromise = refreshAccessSession().finally(() => {
          refreshPromise = null;
        });
      }

      try {
        await refreshPromise;
        return axiosClient(originalRequest);
      } catch {
        devWarn("[Axios] Session refresh failed");
      }
    }

    if (status === 401 || status === 403) {
      devWarn("[Axios] Auth error status", status, "- user session expired");
    }

    return Promise.reject(error);
  },
);
