import { useQuery, useMutation, useQueryClient, useInfiniteQuery, InfiniteData } from "@tanstack/react-query";
import {
	createComment,
	getCommentsByPostId,
	getCommentReplies,
	updateComment,
	deleteComment,
	getCommentsByUserId,
	toggleCommentLike,
	getCommentThread,
	getCommentDirectReplies,
	CommentThreadResponse,
} from "../../api/commentsApi";
import { IComment, CommentCreateDto, CommentUpdateDto, CommentsPaginationResponse } from "../../types";
import { devError } from "@/lib/devLogger";

export const useCommentsByPostId = (postPublicId: string, limit: number = 10) => {
	return useInfiniteQuery<CommentsPaginationResponse, Error>({
		queryKey: ["comments", "post", postPublicId],
		queryFn: ({ pageParam = 1 }) => getCommentsByPostId(postPublicId, pageParam as number, limit),
		getNextPageParam: (lastPage) => {
			if (lastPage.page < lastPage.totalPages) {
				return lastPage.page + 1;
			}
			return undefined;
		},
		initialPageParam: 1,
		enabled: !!postPublicId,
		staleTime: 0, // Comments should be fresh
	});
};

export const useCommentReplies = (postPublicId: string, parentCommentId: string, limit: number = 10) => {
	return useInfiniteQuery<CommentsPaginationResponse, Error>({
		queryKey: ["comments", "post", postPublicId, "replies", parentCommentId],
		queryFn: ({ pageParam = 1 }) => getCommentReplies(postPublicId, parentCommentId, pageParam as number, limit),
		getNextPageParam: (lastPage) => {
			if (lastPage.page < lastPage.totalPages) {
				return lastPage.page + 1;
			}
			return undefined;
		},
		initialPageParam: 1,
		enabled: !!postPublicId && !!parentCommentId,
		staleTime: 0,
	});
};

/**
 * Get comments for an image (single page)
 */
export const useCommentsForPost = (postPublicId: string, page: number = 1, limit: number = 10) => {
	return useQuery<CommentsPaginationResponse, Error>({
		queryKey: ["comments", "post", postPublicId, page, limit],
		queryFn: () => getCommentsByPostId(postPublicId, page, limit),
		enabled: !!postPublicId,
		staleTime: 0,
	});
};

/**
 * Create a new comment
 */
export const useCreateComment = () => {
	const queryClient = useQueryClient();

	return useMutation<IComment, Error, { imagePublicId: string; commentData: CommentCreateDto }>({
		mutationFn: ({ imagePublicId, commentData }) => createComment(imagePublicId, commentData),
		onSuccess: (newComment, { imagePublicId, commentData }) => {
			// Invalidate and refetch comments for this post
			queryClient.invalidateQueries({
				queryKey: ["comments", "post", imagePublicId],
			});

			// Update the post's comment count
			queryClient.invalidateQueries({
				queryKey: ["post", imagePublicId],
			});

			// Update posts list to reflect new comment count
			queryClient.invalidateQueries({
				queryKey: ["posts"],
			});
			queryClient.invalidateQueries({
				queryKey: ["personalizedFeed"],
			});
			queryClient.invalidateQueries({
				queryKey: ["newFeed"],
			});

			// Invalidate thread view if this is a reply
			if (commentData.parentId) {
				queryClient.invalidateQueries({
					queryKey: ["comment", "thread", commentData.parentId],
				});
				queryClient.invalidateQueries({
					queryKey: ["comment", "directReplies", commentData.parentId],
				});
			}
		},
		onError: (error: Error) => {
			devError("Error creating comment:", error);
		},
	});
};

/**
 * Update a comment
 */
export const useUpdateComment = () => {
	const queryClient = useQueryClient();

	return useMutation<IComment, Error, { commentId: string; commentData: CommentUpdateDto }>({
		mutationFn: ({ commentId, commentData }) => updateComment(commentId, commentData),
		onSuccess: (updatedComment) => {
			// Invalidate comments for the post this comment belongs to
			queryClient.invalidateQueries({
				queryKey: ["comments", "post", updatedComment.postPublicId],
			});
		},
		onError: (error: Error) => {
			devError("Error updating comment:", error);
		},
	});
};

/**
 * Delete a comment
 */
export const useDeleteComment = () => {
	const queryClient = useQueryClient();

	return useMutation<void, Error, { commentId: string; postPublicId: string; parentId?: string | null }>({
		mutationFn: ({ commentId }) => deleteComment(commentId),
		onSuccess: (_, { postPublicId, commentId, parentId }) => {
			// Invalidate and refetch comments for this post
			queryClient.invalidateQueries({
				queryKey: ["comments", "post", postPublicId],
			});

			// Update the post's comment count
			queryClient.invalidateQueries({
				queryKey: ["post", postPublicId],
			});

			// Update posts list to reflect new comment count
			queryClient.invalidateQueries({
				queryKey: ["posts"],
			});
			queryClient.invalidateQueries({
				queryKey: ["personalizedFeed"],
			});
			queryClient.invalidateQueries({
				queryKey: ["newFeed"],
			});

			// Invalidate thread view queries
			queryClient.invalidateQueries({
				queryKey: ["comment", "thread", commentId],
			});
			queryClient.invalidateQueries({
				queryKey: ["comment", "directReplies", commentId],
			});

			// If this comment has a parent, invalidate parent's replies
			if (parentId) {
				queryClient.invalidateQueries({
					queryKey: ["comment", "thread", parentId],
				});
				queryClient.invalidateQueries({
					queryKey: ["comment", "directReplies", parentId],
				});
			}
		},
		onError: (error: Error) => {
			devError("Error deleting comment:", error);
		},
	});
};

/**
 * Like / unlike a comment
 */
export const useLikeComment = () => {
	const queryClient = useQueryClient();

	return useMutation<
		{ commentId: string; isLiked: boolean; likesCount: number },
		Error,
		{ commentId: string; postPublicId: string }
	>({
		mutationFn: ({ commentId }) => toggleCommentLike(commentId),
		onSuccess: (result, variables) => {
			// Update comments in post view
			queryClient.setQueriesData<InfiniteData<CommentsPaginationResponse>>(
				{ queryKey: ["comments", "post", variables.postPublicId] },
				(existing) => {
					if (!existing) return existing;
					return {
						...existing,
						pages: existing.pages.map((page) => ({
							...page,
							comments: page.comments.map((comment) =>
								comment.id === result.commentId
									? {
											...comment,
											likesCount: result.likesCount,
											isLikedByViewer: result.isLiked,
										}
									: comment
							),
						})),
					};
				}
			);

			// Update thread view if applicable
			queryClient.invalidateQueries({
				queryKey: ["comment", "thread", variables.commentId],
			});
			queryClient.invalidateQueries({
				queryKey: ["comment", "directReplies"],
			});
		},
		onError: (error: Error) => {
			devError("Error liking comment:", error);
		},
	});
};

export const useCommentsByUserId = (userId: string, page: number = 1, limit: number = 10) => {
	return useQuery<CommentsPaginationResponse, Error>({
		queryKey: ["comments", "user", userId, page, limit],
		queryFn: () => getCommentsByUserId(userId, page, limit),
		enabled: !!userId,
		staleTime: 5 * 60 * 1000, // 5 minutes for user comments
	});
};

export const useCommentThread = (commentId: string) => {
	return useQuery<CommentThreadResponse, Error>({
		queryKey: ["comment", "thread", commentId],
		queryFn: () => getCommentThread(commentId),
		enabled: !!commentId,
		staleTime: 0,
	});
};

export const useCommentDirectReplies = (commentId: string, limit: number = 10) => {
	return useInfiniteQuery<CommentsPaginationResponse, Error>({
		queryKey: ["comment", "directReplies", commentId],
		queryFn: ({ pageParam = 1 }) => getCommentDirectReplies(commentId, pageParam as number, limit),
		getNextPageParam: (lastPage) => {
			if (lastPage.page < lastPage.totalPages) {
				return lastPage.page + 1;
			}
			return undefined;
		},
		initialPageParam: 1,
		enabled: !!commentId,
		staleTime: 0,
	});
};
