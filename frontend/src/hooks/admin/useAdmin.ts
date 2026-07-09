import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
	fetchAllUsersAdmin,
	fetchUserAdmin,
	fetchUserStats,
	banUser,
	unbanUser,
	promoteToAdmin,
	demoteFromAdmin,
	deleteUserAdmin,
	fetchAllImagesAdmin,
	deleteImageAdmin,
	deleteCommentAdmin,
	removeUserFavoriteAdmin,
	fetchDashboardStats,
	fetchRecentActivity,
	clearCache,
	fetchTelemetryMetrics,
	fetchRequestLogs,
	fetchAuthActivityLogs,
} from "../../api/adminApi";
import { toast } from "react-toastify";

export const useAdminUsers = (params: {
	page?: number;
	limit?: number;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
	search?: string;
	startDate?: string;
	endDate?: string;
}) => {
	return useQuery({
		queryKey: ["admin", "users", params],
		queryFn: () => fetchAllUsersAdmin(params),
		staleTime: 30000,
	});
};

export const useAdminUser = (publicId: string | undefined) => {
	return useQuery({
		queryKey: ["admin", "user", publicId],
		queryFn: () => fetchUserAdmin(publicId!),
		enabled: !!publicId,
	});
};

export const useUserStats = (publicId: string | undefined) => {
	return useQuery({
		queryKey: ["admin", "userStats", publicId],
		queryFn: () => fetchUserStats(publicId!),
		enabled: !!publicId,
	});
};

export const useBanUser = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ publicId, reason }: { publicId: string; reason: string }) => banUser(publicId, reason),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			toast.success("user banned successfully");
		},
		onError: (error: Error) => {
			toast.error(`failed to ban user: ${error.message}`);
		},
	});
};

export const useUnbanUser = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (publicId: string) => unbanUser(publicId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			toast.success("user unbanned successfully");
		},
		onError: (error: Error) => {
			toast.error(`failed to unban user: ${error.message}`);
		},
	});
};

export const usePromoteToAdmin = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (publicId: string) => promoteToAdmin(publicId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			toast.success("user promoted to admin");
		},
		onError: (error: Error) => {
			toast.error(`failed to promote user: ${error.message}`);
		},
	});
};

export const useDemoteFromAdmin = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (publicId: string) => demoteFromAdmin(publicId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			toast.success("admin privileges removed");
		},
		onError: (error: Error) => {
			toast.error(`failed to demote user: ${error.message}`);
		},
	});
};

export const useDeleteUserAdmin = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (publicId: string) => deleteUserAdmin(publicId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			toast.success("user deleted successfully");
		},
		onError: (error: Error) => {
			toast.error(`failed to delete user: ${error.message}`);
		},
	});
};

export const useAdminImages = (params: {
	page?: number;
	limit?: number;
	sortBy?: string;
	sortOrder?: "asc" | "desc";
}) => {
	return useQuery({
		queryKey: ["admin", "images", params],
		queryFn: () => fetchAllImagesAdmin(params),
		staleTime: 30000,
	});
};

export const useDeleteImageAdmin = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (publicId: string) => deleteImageAdmin(publicId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["admin", "images"] });
			toast.success("image deleted successfully");
		},
		onError: (error: Error) => {
			toast.error(`failed to delete image: ${error.message}`);
		},
	});
};

export const useDeleteCommentAdmin = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (commentId: string) => deleteCommentAdmin(commentId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["userComments"] });
			toast.success("comment deleted successfully");
		},
		onError: (error: Error) => {
			toast.error(`failed to delete comment: ${error.message}`);
		},
	});
};

export const useRemoveUserFavoriteAdmin = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ userPublicId, postPublicId }: { userPublicId: string; postPublicId: string }) =>
			removeUserFavoriteAdmin(userPublicId, postPublicId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["userLikedPosts"] });
			toast.success("favorite removed successfully");
		},
		onError: (error: Error) => {
			toast.error(`failed to remove favorite: ${error.message}`);
		},
	});
};

export const useDashboardStats = () => {
	return useQuery({
		queryKey: ["admin", "dashboardStats"],
		queryFn: fetchDashboardStats,
		staleTime: 60000,
	});
};

export const useRecentActivity = (params: { page?: number; limit?: number }) => {
	return useQuery({
		queryKey: ["admin", "recentActivity", params],
		queryFn: () => fetchRecentActivity(params),
		staleTime: 30000,
	});
};

export const useClearCache = () => {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (pattern?: string) => clearCache(pattern),
		onSuccess: (data) => {
			toast.success(`Cache cleared: ${data.deletedKeys} keys deleted`);
			queryClient.invalidateQueries({ queryKey: ["feed"] });
			queryClient.invalidateQueries({ queryKey: ["admin"] });
		},
		onError: (error: unknown) => {
			const message = error instanceof Error ? error.message : "Failed to clear cache";
			toast.error(message);
		},
	});
};

export const useTelemetryMetrics = () => {
	return useQuery({
		queryKey: ["admin", "telemetry"],
		queryFn: fetchTelemetryMetrics,
		staleTime: 30000,
		refetchInterval: 60000,
	});
};

export const useRequestLogs = (params: {
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
}) => {
	return useQuery({
		queryKey: ["admin", "requestLogs", params],
		queryFn: () => fetchRequestLogs(params),
		staleTime: 10000,
	});
};

export const useAuthActivityLogs = (params: {
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
}) => {
	return useQuery({
		queryKey: ["admin", "authActivityLogs", params],
		queryFn: () => fetchAuthActivityLogs(params),
		staleTime: 10000,
	});
};
