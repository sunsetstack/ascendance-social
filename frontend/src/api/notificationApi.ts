import axiosClient from "./axiosClient";
import { Notification, NotificationPage } from "../types";
import { mapNotification } from "../lib/mappers";

// Small helper to unwrap axios responses with generics
const unwrap = <T>(promise: Promise<{ data: T }>) =>
  promise.then((r) => r.data);

const errorMessage = (err: unknown): string => {
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
};

/**
 * Fetch notifications for the current authenticated user with cursor-based pagination
 * Maps backend shape to strongly typed Notification objects.
 * @param signal - AbortSignal for cancellation
 * @param before - ISO timestamp cursor for pagination (fetch notifications older than this)
 */
export const fetchNotifications = async (
  signal?: AbortSignal,
  before?: string,
): Promise<NotificationPage> => {
  try {
    const params: { before?: string } = {};
    if (before) {
      params.before = before;
    }

    const response = await unwrap<{
      data: unknown[];
      hasMore?: boolean;
      nextCursor?: string;
    }>(
      axiosClient.get("/api/notifications", {
        signal,
        params,
      }),
    );
    return {
      data: response.data.map(mapNotification),
      hasMore: response.hasMore === true,
      nextCursor: response.nextCursor,
    };
  } catch (error) {
    throw new Error(`fetchNotifications failed: ${errorMessage(error)}`);
  }
};

/**
 * Mark a notification as read.
 */
export const markNotificationAsRead = async (
  notificationId: string,
  signal?: AbortSignal,
): Promise<Notification> => {
  if (!notificationId || typeof notificationId !== "string") {
    throw new Error("notificationId is required");
  }
  try {
    const raw = await unwrap<unknown>(
      axiosClient.post(
        `/api/notifications/read/${notificationId}`,
        undefined,
        { signal },
      ),
    );
    return mapNotification(raw);
  } catch (error) {
    throw new Error(`markNotificationAsRead failed: ${errorMessage(error)}`);
  }
};
