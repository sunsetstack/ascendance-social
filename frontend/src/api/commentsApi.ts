import axiosClient from "./axiosClient";
import {
  IComment,
  CommentCreateDto,
  CommentUpdateDto,
  CommentsPaginationResponse,
} from "../types";

export interface CommentLikeResponse {
  commentId: string;
  isLiked: boolean;
  likesCount: number;
}

const BASE_URL = "/api";

/**
 * Create a new comment on a post
 */
export const createComment = async (
  postPublicId: string,
  commentData: CommentCreateDto,
): Promise<IComment> => {
  const response = await axiosClient.post(
    `${BASE_URL}/posts/${postPublicId}/comments`,
    commentData,
  );
  return response.data;
};

/**
 * Get comments for a post with pagination
 */
export const getCommentsByPostId = async (
  postPublicId: string,
  page: number = 1,
  limit: number = 10,
): Promise<CommentsPaginationResponse> => {
  const response = await axiosClient.get(
    `${BASE_URL}/posts/${postPublicId}/comments`,
    {
      params: { page, limit },
    },
  );

  return response.data;
};

/**
 * Get replies for a comment with pagination
 */
export const getCommentReplies = async (
  postPublicId: string,
  parentCommentId: string,
  page: number = 1,
  limit: number = 10,
): Promise<CommentsPaginationResponse> => {
  const response = await axiosClient.get(
    `${BASE_URL}/posts/${postPublicId}/comments`,
    {
      params: { page, limit, parentId: parentCommentId },
    },
  );
  return response.data;
};

// Legacy alias for backward compatibility
export const getCommentsByImageId = getCommentsByPostId;

/**
 * Update a comment
 */
export const updateComment = async (
  commentId: string,
  commentData: CommentUpdateDto,
): Promise<IComment> => {
  const response = await axiosClient.put(
    `${BASE_URL}/comments/${commentId}`,
    commentData,
  );
  return response.data;
};

/**
 * Delete a comment
 */
export const deleteComment = async (commentId: string): Promise<void> => {
  await axiosClient.delete(`${BASE_URL}/comments/${commentId}`);
};

/**
 * Get comments by user ID
 */
export const getCommentsByUserId = async (
  userId: string,
  page: number = 1,
  limit: number = 10,
): Promise<CommentsPaginationResponse> => {
  const response = await axiosClient.get(
    `${BASE_URL}/users/${userId}/comments`,
    {
      params: { page, limit },
    },
  );
  return response.data;
};

/**
 * Toggle like on a comment
 */
export const toggleCommentLike = async (
  commentId: string,
): Promise<CommentLikeResponse> => {
  const response = await axiosClient.post(
    `${BASE_URL}/comments/${commentId}/like`,
  );
  return response.data;
};

export interface CommentThreadResponse {
  comment: IComment;
  ancestors: IComment[];
}

export const getCommentThread = async (
  commentId: string,
): Promise<CommentThreadResponse> => {
  const response = await axiosClient.get(
    `${BASE_URL}/comments/${commentId}/thread`,
  );
  return response.data;
};

export const getCommentDirectReplies = async (
  commentId: string,
  page: number = 1,
  limit: number = 10,
): Promise<CommentsPaginationResponse> => {
  const response = await axiosClient.get(
    `${BASE_URL}/comments/${commentId}/replies`,
    {
      params: { page, limit },
    },
  );
  return response.data;
};
