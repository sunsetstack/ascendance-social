import axios, {
  AxiosError,
  AxiosRequestConfig,
  AxiosRequestHeaders,
  InternalAxiosRequestConfig,
} from "axios";
import { devWarn } from "@/lib/devLogger";
import {
  getApiErrorPayload,
  resolveApiErrorMessage,
  type ApiErrorResponse,
} from "./errorMessages";
import {
  AuthRefreshCoordinator,
  shouldAttemptAuthRefresh,
} from "./authRefreshCoordinator";

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
  _clientRequestId?: string;
  _clientRequestAttempt?: number;
  _causedByClientRequestId?: string;
}

interface ObservableRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
  _clientRequestId?: string;
  _clientRequestAttempt?: number;
  _causedByClientRequestId?: string;
}

const AUTH_BYPASS_ENDPOINTS = [
  "/api/users/login",
  "/api/users/register",
  "/api/users/refresh",
  "/api/users/logout",
];

const CLIENT_REQUEST_ID_HEADER = "x-client-request-id";
const CLIENT_BOOT_ID_HEADER = "x-client-boot-id";
const CLIENT_REQUEST_ATTEMPT_HEADER = "x-client-request-attempt";
const AXIOS_RETRY_HEADER = "x-axios-retry";
const PREVIOUS_CLIENT_REQUEST_ID_HEADER = "x-previous-client-request-id";
const CAUSED_BY_CLIENT_REQUEST_ID_HEADER = "x-caused-by-client-request-id";

const axiosClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

function createUuid(): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const clientBootId = createUuid();
let previousClientRequestId: string | undefined;

function resolveClientBootId(): string {
  return clientBootId;
}

function getHeaderValue(
  headers: AxiosRequestHeaders | undefined,
  name: string,
): string | undefined {
  const value = headers?.[name];
  if (typeof value === "string") {
    return value;
  }

  return undefined;
}

function resolveClientRequestId(config: RetryableRequestConfig): string {
  const headers = config.headers as AxiosRequestHeaders | undefined;
  return (
    config._clientRequestId ??
    getHeaderValue(headers, CLIENT_REQUEST_ID_HEADER) ??
    createUuid()
  );
}

function resolveClientRequestAttempt(config: RetryableRequestConfig): number {
  const headers = config.headers as AxiosRequestHeaders | undefined;
  const headerAttempt = Number(
    getHeaderValue(headers, CLIENT_REQUEST_ATTEMPT_HEADER),
  );
  const configuredAttempt = config._clientRequestAttempt;
  if (
    typeof configuredAttempt === "number" &&
    Number.isSafeInteger(configuredAttempt)
  ) {
    return Math.max(1, configuredAttempt);
  }

  if (Number.isSafeInteger(headerAttempt) && headerAttempt > 0) {
    return headerAttempt;
  }

  return 1;
}

axiosClient.interceptors.request.use((config) => {
  const observableConfig = config as RetryableRequestConfig;
  const clientRequestId = resolveClientRequestId(observableConfig);
  const requestAttempt = resolveClientRequestAttempt(observableConfig);
  const headers = (config.headers as AxiosRequestHeaders) ?? {};

  headers[CLIENT_REQUEST_ID_HEADER] = clientRequestId;
  headers[CLIENT_BOOT_ID_HEADER] = resolveClientBootId();
  headers[CLIENT_REQUEST_ATTEMPT_HEADER] = String(requestAttempt);

  if (observableConfig._retry || requestAttempt > 1) {
    headers[AXIOS_RETRY_HEADER] = "true";
  } else {
    delete headers[AXIOS_RETRY_HEADER];
  }

  if (
    previousClientRequestId &&
    previousClientRequestId !== clientRequestId &&
    !headers[PREVIOUS_CLIENT_REQUEST_ID_HEADER]
  ) {
    headers[PREVIOUS_CLIENT_REQUEST_ID_HEADER] = previousClientRequestId;
  }

  if (observableConfig._causedByClientRequestId) {
    headers[CAUSED_BY_CLIENT_REQUEST_ID_HEADER] =
      observableConfig._causedByClientRequestId;
  } else {
    delete headers[CAUSED_BY_CLIENT_REQUEST_ID_HEADER];
  }

  observableConfig._clientRequestId = clientRequestId;
  observableConfig._clientRequestAttempt = requestAttempt;
  previousClientRequestId = clientRequestId;
  config.headers = headers;
  return config;
});

const authRefreshCoordinator = new AuthRefreshCoordinator();

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

const refreshAccessSession = async (
  causedByClientRequestId?: string,
): Promise<void> => {
  await axiosClient.post("/api/users/refresh", undefined, {
    _causedByClientRequestId: causedByClientRequestId,
  } as ObservableRequestConfig);
};

export default axiosClient;

// Global response interceptor to catch auth expiry
axiosClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const status = error.response?.status;
    const payload = getApiErrorPayload(error.response?.data);

    if (payload) {
      error.message = resolveApiErrorMessage(payload, error.message);
      if (payload.errorCode) {
        (
          error as AxiosError<ApiErrorResponse> & { errorCode: string }
        ).errorCode = payload.errorCode;
      }
    }

    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const shouldRefresh = shouldAttemptAuthRefresh(
      status,
      originalRequest,
      shouldBypassRefresh(originalRequest?.url),
    );

    if (shouldRefresh && originalRequest) {
      originalRequest._retry = true;
      const originalClientRequestId =
        originalRequest._clientRequestId ??
        getHeaderValue(
          originalRequest.headers as AxiosRequestHeaders | undefined,
          CLIENT_REQUEST_ID_HEADER,
        );
      originalRequest._clientRequestId =
        originalClientRequestId ?? createUuid();
      originalRequest._clientRequestAttempt =
        resolveClientRequestAttempt(originalRequest) + 1;

      try {
        await authRefreshCoordinator.waitForRefresh(() =>
          refreshAccessSession(originalRequest._clientRequestId),
        );
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
