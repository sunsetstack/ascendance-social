export interface ApiErrorPayload {
  type?: string;
  message?: string;
  code?: number;
  errorCode?: string;
}

export interface ApiErrorResponse {
  error?: ApiErrorPayload;
  message?: string;
  errorCode?: string;
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_1001: "Invalid email or password.",
  AUTH_1002: "Your session expired. Please sign in again.",
  AUTH_1003: "Your session is invalid. Please sign in again.",
  AUTH_1004: "Please sign in to continue.",
  AUTH_1005: "You do not have permission to do that.",
  AUTH_1006: "Please verify your email before continuing.",

  VAL_2001: "Please check the highlighted fields and try again.",
  VAL_2002: "Some of the submitted information is invalid.",
  VAL_2003: "Please fill in the required fields.",
  VAL_2004: "Please use the expected format and try again.",

  RES_3001: "User not found.",
  RES_3002: "Post not found.",
  RES_3003: "Comment not found.",
  RES_3004: "Community not found.",
  RES_3005: "Image not found.",

  CONF_4001: "That email is already in use.",
  CONF_4002: "That handle is already taken.",
  CONF_4003: "That resource already exists.",
  CONF_4004: "That already exists.",

  SRV_5001: "Something went wrong. Please try again.",
  SRV_5002: "Something went wrong. Please try again.",
  SRV_5003: "The file service is temporarily unavailable.",
  SRV_5004: "The request could not be completed. Please try again.",
  SRV_5005: "The service is temporarily unavailable.",

  EXT_6001: "The upload failed. Please try again.",
  EXT_6002: "The email service is temporarily unavailable.",
  EXT_6003: "An external service is temporarily unavailable.",
};

export const getApiErrorPayload = (
  response?: ApiErrorResponse,
): ApiErrorPayload | undefined => {
  return response?.error ?? response;
};

export const resolveApiErrorMessage = (
  payload?: ApiErrorPayload,
  fallback = "Something went wrong. Please try again.",
): string => {
  if (!payload) return fallback;
  if (payload.errorCode && ERROR_MESSAGES[payload.errorCode]) {
    return ERROR_MESSAGES[payload.errorCode];
  }
  return payload.message ?? fallback;
};
