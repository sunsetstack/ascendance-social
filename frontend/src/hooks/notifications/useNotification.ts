import { useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  InfiniteData,
} from "@tanstack/react-query";
import {
  fetchNotifications,
  markNotificationAsRead,
} from "../../api/notificationApi";
import { Notification, NotificationPage } from "../../types";
import { useSocket } from "../context/useSocket";
import { useAuth } from "../context/useAuth";

export const useNotifications = () => {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isVerified = user
    ? !("isEmailVerified" in user) || user.isEmailVerified !== false
    : false;

  const notificationsQuery = useInfiniteQuery<NotificationPage>({
    queryKey: ["notifications"],
    queryFn: ({ signal, pageParam }) => {
      return fetchNotifications(signal, pageParam as string | undefined);
    },
    enabled: isVerified,
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => {
      return lastPage.hasMore ? lastPage.nextCursor : undefined;
    },
    staleTime: 5 * 60_000, // 5 minutes
    gcTime: 10 * 60_000, // 10 minutes
    refetchOnWindowFocus: false,
  });

  // flatten all pages into single array
  const notifications = useMemo(() => {
    if (!notificationsQuery.data) return [];
    return notificationsQuery.data.pages.flatMap((page) => page.data);
  }, [notificationsQuery.data]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationAsRead(id),
    // Make use of optimistic update
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previous = queryClient.getQueryData<InfiniteData<NotificationPage>>(
        ["notifications"],
      );

      queryClient.setQueryData<InfiniteData<NotificationPage>>(
        ["notifications"],
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((notification) =>
                notification.id === id
                  ? { ...notification, isRead: true }
                  : notification,
              ),
            })),
          };
        },
      );

      return { previous };
    },
    onError: (
      _err,
      _id,
      context: { previous?: InfiniteData<NotificationPage> } | undefined,
    ) => {
      if (context?.previous) {
        queryClient.setQueryData(["notifications"], context.previous);
      }
    },
    onSuccess: () => {},
  });

  // This handles real-time notifications with WebSocket
  useEffect(() => {
    if (!socket || !isVerified) return;

    const handleNew = (notification: Notification) => {
      queryClient.setQueryData<InfiniteData<NotificationPage>>(
        ["notifications"],
        (oldData) => {
          if (!oldData) {
            return {
              pages: [
                {
                  data: [notification],
                  hasMore: false,
                },
              ],
              pageParams: [undefined],
            };
          }

          const exists = oldData.pages.some((page) =>
            page.data.some(
              (existingNotification) =>
                existingNotification.id === notification.id,
            ),
          );
          if (exists) {
            return oldData;
          }
          const newPages = [...oldData.pages];
          newPages[0] = {
            ...newPages[0],
            data: [notification, ...newPages[0].data],
          };

          return {
            ...oldData,
            pages: newPages,
          };
        },
      );
    };

    const handleRead = (updatedNotification: Notification) => {
      queryClient.setQueryData<InfiniteData<NotificationPage>>(
        ["notifications"],
        (old) => {
          if (!old?.pages) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              data: page.data.map((notification) =>
                notification.id === updatedNotification.id
                  ? updatedNotification
                  : notification,
              ),
            })),
          };
        },
      );
    };

    socket.on("new_notification", handleNew);

    socket.on("notification_read", handleRead);

    return () => {
      socket.off("new_notification", handleNew);
      socket.off("notification_read", handleRead);
    };
  }, [socket, queryClient, isVerified]);

  return {
    notifications,
    isLoading: notificationsQuery.isLoading,
    isError: notificationsQuery.isError,
    isFetchingNextPage: notificationsQuery.isFetchingNextPage,
    hasNextPage: notificationsQuery.hasNextPage,
    fetchNextPage: notificationsQuery.fetchNextPage,
    markAsRead: (id: string) => markReadMutation.mutate(id),
  };
};
