import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocket } from "../context/useSocket";
import {
  removePostDetailAndCommentCaches,
  removePostFromFeedCaches,
  updatePostLikesInFeedCaches,
} from "../posts/postCache";
import { useRecentEventIds } from "../socket/useRecentEventIds";

/**
 * Hook to handle real-time feed updates via WebSocket
 * Integrates socket events with React Query cache invalidation
 */
export const useFeedSocketIntegration = () => {
  const socket = useSocket();
  const queryClient = useQueryClient();
  const shouldHandleEvent = useRecentEventIds();

  useEffect(() => {
    if (!socket) return;

    /**
     * Handle new post uploads (targeted to specific users)
     * Backend event: "feed_update" with type: "new_post"
     */
    const handleNewPost = (data: {
      type: "new_post";
      authorId: string;
      postId: string;
      tags: string[];
      affectedUsers: string[];
      timestamp: string;
    }) => {
      // Invalidate personalized feeds
      queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
      queryClient.invalidateQueries({ queryKey: ["forYouFeed"] });
      queryClient.invalidateQueries({ queryKey: ["images"] });

      // Also invalidate author's profile posts
      queryClient.invalidateQueries({
        queryKey: ["userImages", data.authorId],
      });
    };

    /**
     * Handle post deletion.
     * Backend event: "feed_update" with type: "post_deleted"
     */
    const handlePostDeleted = (data: {
      type: "post_deleted";
      postId: string;
      authorId: string;
      timestamp: string;
    }) => {
      removePostFromFeedCaches(queryClient, data.postId);
      removePostDetailAndCommentCaches(queryClient, data.postId);

      // Invalidate author profile stats (post count changed)
      queryClient.invalidateQueries({
        queryKey: ["userImages", data.authorId],
      });
    };

    /**
     * Route all "feed_update" events by type.
     */
    const handleFeedUpdate = (data: {
      type: string;
      eventId?: string;
      [key: string]: unknown;
    }) => {
      if (!shouldHandleEvent(data.eventId)) return;

      if (data.type === "new_post") {
        handleNewPost(data as Parameters<typeof handleNewPost>[0]);
      } else if (data.type === "post_deleted") {
        handlePostDeleted(data as Parameters<typeof handlePostDeleted>[0]);
      }
    };

    /**
     * Handle like count updates
     * Backend event: "like_update" with type: "like_count_changed"
     */
    const handleLikeUpdate = (data: {
      type: "like_count_changed";
      eventId?: string;
      imageId: string;
      newLikes: number;
      timestamp: string;
    }) => {
      if (!shouldHandleEvent(data.eventId)) return;

      updatePostLikesInFeedCaches(queryClient, data.imageId, data.newLikes);

      // Update specific image queries
      queryClient.invalidateQueries({ queryKey: ["image", data.imageId] });
    };

    /**
     * Handle avatar updates
     * Backend event: "avatar_update" with type: "user_avatar_changed"
     */
    const handleAvatarUpdate = (data: {
      type: "user_avatar_changed";
      eventId?: string;
      userId: string;
      oldAvatar?: string;
      newAvatar?: string;
      timestamp: string;
    }) => {
      if (!shouldHandleEvent(data.eventId)) return;

      // Invalidate user data and any feed that shows avatars
      const currentUser = queryClient.getQueryData<{ publicId?: string }>([
        "currentUser",
      ]);
      if (currentUser?.publicId === data.userId) {
        queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      }

      // Invalidate all user queries to ensure any view (by handle or ID) gets updated
      queryClient.invalidateQueries({ queryKey: ["user"] });
      queryClient.invalidateQueries({ queryKey: ["user", data.userId] });
      queryClient.invalidateQueries({
        queryKey: ["user", "publicId", data.userId],
      });

      queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
      queryClient.invalidateQueries({ queryKey: ["forYouFeed"] });
      queryClient.invalidateQueries({ queryKey: ["trendingFeed"] });
      queryClient.invalidateQueries({ queryKey: ["newFeed"] });
      queryClient.invalidateQueries({ queryKey: ["images"] });
    };

    /**
     * Handle general feed interactions
     * Backend event: "feed_interaction" with type: "user_interaction"
     */
    const handleFeedInteraction = (data: {
      type: "user_interaction";
      eventId?: string;
      userId: string;
      actionType: string;
      targetId: string;
      tags?: string[];
      timestamp: string;
    }) => {
      if (!shouldHandleEvent(data.eventId)) return;

      // For comments and other interactions that affect counts
      if (
        data.actionType === "comment" ||
        data.actionType === "comment_deleted"
      ) {
        // Invalidate specific post and comment queries for this post
        queryClient.invalidateQueries({ queryKey: ["image"] }); // Refresh image details (comment count)
        queryClient.invalidateQueries({
          queryKey: ["comments", "post", data.targetId],
        }); // Refresh comment list

        // Only invalidate the personalized feed - most relevant for the user
        queryClient.invalidateQueries({ queryKey: ["personalizedFeed"] });
      }
    };

    // Register all socket event listeners
    socket.on("feed_update", handleFeedUpdate);
    socket.on("like_update", handleLikeUpdate);
    socket.on("avatar_update", handleAvatarUpdate);
    socket.on("feed_interaction", handleFeedInteraction);

    return () => {
      // Cleanup listeners
      socket.off("feed_update", handleFeedUpdate);
      socket.off("like_update", handleLikeUpdate);
      socket.off("avatar_update", handleAvatarUpdate);
      socket.off("feed_interaction", handleFeedInteraction);
    };
  }, [socket, queryClient, shouldHandleEvent]);
};
