import {
	useQuery,
	useInfiniteQuery,
	UseInfiniteQueryOptions,
	InfiniteData,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import type { AxiosError } from "axios";
import {
	fetchCurrentUser,
	fetchUserByPublicId,
	fetchUserByHandle,
	fetchUserPosts,
	fetchUserLikedPosts,
	fetchUserComments,
	updateUserAvatar as updateUserAvatarApi,
	updateUserCover as updateUserCoverApi,
	fetchFollowers,
	fetchFollowing,
	FollowListResponse,
} from "../../api/userApi";
import { ImagePageData, PublicUserDTO, AuthenticatedUserDTO, AdminUserDTO, CommentsPaginationResponse } from "../../types";
import { editUserRequest, changePasswordRequest } from "../../api/userApi";

type UseUserImagesOptions = Omit<
	UseInfiniteQueryOptions<ImagePageData, Error, InfiniteData<ImagePageData, number>>,
	"queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
>;

type UseUserCommentsOptions = Omit<
	UseInfiniteQueryOptions<
		CommentsPaginationResponse,
		Error,
		InfiniteData<CommentsPaginationResponse, number>
	>,
	"queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
>;

type UseFollowListOptions = Omit<
	UseInfiniteQueryOptions<FollowListResponse, Error, InfiniteData<FollowListResponse, number>>,
	"queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
>;

// Get current authenticated user at /me
export const useCurrentUser = () => {
	const queryClient = useQueryClient();
	const cachedUser = queryClient.getQueryData<AuthenticatedUserDTO | AdminUserDTO>(["currentUser"]);
	const isEmailVerified = cachedUser
		? !("isEmailVerified" in cachedUser) || cachedUser.isEmailVerified !== false
		: true;

	return useQuery<AuthenticatedUserDTO | AdminUserDTO | null>({
		queryKey: ["currentUser"],
		queryFn: ({ signal }) => fetchCurrentUser(signal),
		staleTime: 5 * 60_000,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
		enabled: isEmailVerified,
		retry: (failureCount, error) => {
			const status = (error as AxiosError<{ message?: string }>).response?.status;
			if (status === 401 || status === 403) {
				return false;
			}
			return failureCount < 2;
		},
	});
};

export const useGetUserByPublicId = (publicId: string | undefined) => {
	return useQuery<PublicUserDTO>({
		queryKey: ["user", "publicId", publicId],
		queryFn: ({ queryKey }) => fetchUserByPublicId({ queryKey: [queryKey[0] as string, queryKey[2] as string] }),
		enabled: !!publicId,
		staleTime: 60000,
	});
};

export const useGetUserByHandle = (handle: string | undefined) => {
	return useQuery<PublicUserDTO>({
		queryKey: ["user", "handle", handle],
		queryFn: ({ queryKey }) => fetchUserByHandle({ queryKey: [queryKey[0] as string, queryKey[2] as string] }),
		enabled: !!handle,
		staleTime: 60000,
	});
};

export const useGetUser = (identifier: string | undefined) => {
	const queryClient = useQueryClient();

	const currentUser = queryClient.getQueryData<AuthenticatedUserDTO | AdminUserDTO>(["currentUser"]);
	const isViewingSelf =
		currentUser?.publicId === identifier || currentUser?.handle === identifier || currentUser?.username === identifier;
	const isPublicId = !!identifier && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);

	return useQuery<PublicUserDTO>({
		queryKey: ["user", identifier],
		queryFn: () => {
			const freshCurrentUser = queryClient.getQueryData<AuthenticatedUserDTO | AdminUserDTO>(["currentUser"]);
			const isSelf =
				freshCurrentUser?.publicId === identifier ||
				freshCurrentUser?.handle === identifier ||
				freshCurrentUser?.username === identifier;

			if (isSelf && freshCurrentUser) {
				return Promise.resolve(freshCurrentUser as PublicUserDTO);
			}

			if (!identifier) throw new Error("identifier is required");
			return isPublicId
				? fetchUserByPublicId({ queryKey: ["user", identifier] })
				: fetchUserByHandle({ queryKey: ["user", identifier] });
		},
		enabled: !!identifier,
		staleTime: isViewingSelf ? 0 : 60000,
	});
};

export const useUserPosts = (
	userPublicId: string,
	options?: UseUserImagesOptions & { limit?: number; sortBy?: string; sortOrder?: string; page?: number }
) => {
	const limit = options?.limit || 10;
	const sortBy = options?.sortBy || "createdAt";
	const sortOrder = options?.sortOrder || "desc";
	const page = options?.page || 1;

	return useInfiniteQuery({
		queryKey: ["userPosts", userPublicId, limit, sortBy, sortOrder, page] as const,
		queryFn: ({ pageParam = page }) => fetchUserPosts(pageParam as number, userPublicId, limit, sortBy, sortOrder),
		initialPageParam: page,
		getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
		...options,
	});
};

export const useUserLikedPosts = (
	userPublicId: string,
	options?: UseUserImagesOptions & { limit?: number; sortBy?: string; sortOrder?: string; page?: number }
) => {
	const limit = options?.limit || 10;
	const sortBy = options?.sortBy || "createdAt";
	const sortOrder = options?.sortOrder || "desc";
	const page = options?.page || 1;

	return useInfiniteQuery({
		queryKey: ["userLikedPosts", userPublicId, limit, sortBy, sortOrder, page] as const,
		queryFn: ({ pageParam = page }) => fetchUserLikedPosts(pageParam as number, userPublicId, limit, sortBy, sortOrder),
		initialPageParam: page,
		getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
		...options,
	});
};

export const useUserComments = (
	userPublicId: string,
	options?: UseUserCommentsOptions & { limit?: number; sortBy?: string; sortOrder?: string; page?: number }
) => {
	const limit = options?.limit || 10;
	const sortBy = options?.sortBy || "createdAt";
	const sortOrder = options?.sortOrder || "desc";
	const page = options?.page || 1;

	return useInfiniteQuery({
		queryKey: ["userComments", userPublicId, limit, sortBy, sortOrder, page] as const,
		queryFn: ({ pageParam = page }) => fetchUserComments(pageParam as number, userPublicId, limit, sortBy, sortOrder),
		initialPageParam: page,
		getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
		...options,
	});
};

// --- Page-based (non-infinite) hooks for admin/pagination use cases ---

type PageQueryOptions = {
	enabled?: boolean;
	limit?: number;
	sortBy?: string;
	sortOrder?: string;
};

export const useUserPostsPage = (
	userPublicId: string,
	page: number,
	options?: PageQueryOptions,
) => {
	const limit = options?.limit ?? 10;
	const sortBy = options?.sortBy ?? "createdAt";
	const sortOrder = options?.sortOrder ?? "desc";

	return useQuery<ImagePageData>({
		queryKey: ["userPostsPage", userPublicId, page, limit, sortBy, sortOrder] as const,
		queryFn: () => fetchUserPosts(page, userPublicId, limit, sortBy, sortOrder),
		enabled: (options?.enabled ?? true) && !!userPublicId,
		staleTime: 30_000,
	});
};

export const useUserLikedPostsPage = (
	userPublicId: string,
	page: number,
	options?: PageQueryOptions,
) => {
	const limit = options?.limit ?? 10;
	const sortBy = options?.sortBy ?? "createdAt";
	const sortOrder = options?.sortOrder ?? "desc";

	return useQuery<ImagePageData>({
		queryKey: ["userLikedPostsPage", userPublicId, page, limit, sortBy, sortOrder] as const,
		queryFn: () => fetchUserLikedPosts(page, userPublicId, limit, sortBy, sortOrder),
		enabled: (options?.enabled ?? true) && !!userPublicId,
		staleTime: 30_000,
	});
};

export const useUserCommentsPage = (
	userPublicId: string,
	page: number,
	options?: PageQueryOptions,
) => {
	const limit = options?.limit ?? 10;
	const sortBy = options?.sortBy ?? "createdAt";
	const sortOrder = options?.sortOrder ?? "desc";

	return useQuery<CommentsPaginationResponse>({
		queryKey: ["userCommentsPage", userPublicId, page, limit, sortBy, sortOrder] as const,
		queryFn: () => fetchUserComments(page, userPublicId, limit, sortBy, sortOrder),
		enabled: (options?.enabled ?? true) && !!userPublicId,
		staleTime: 30_000,
	});
};

export const useUpdateUserAvatar = () => {
	const queryClient = useQueryClient();
	return useMutation<AuthenticatedUserDTO | AdminUserDTO, Error, Blob>({
		mutationFn: updateUserAvatarApi,
		onSuccess: (data) => {
			queryClient.setQueryData(["currentUser"], data);
			queryClient.setQueryData(["user", data.publicId], data);
			queryClient.setQueryData(["user", "publicId", data.publicId], data);
			queryClient.setQueryData(["user", "handle", data.handle], data);
			queryClient.setQueryData(["user", data.handle], data);

			// Invalidate all user-related queries to ensure consistency across the app
			queryClient.invalidateQueries({ queryKey: ["currentUser"] });
			queryClient.invalidateQueries({ queryKey: ["user"] });
			queryClient.invalidateQueries({ queryKey: ["userPosts", data.publicId] });
		},
	});
};

export const useUpdateUserCover = () => {
	const queryClient = useQueryClient();
	return useMutation<AuthenticatedUserDTO | AdminUserDTO, Error, Blob>({
		mutationFn: updateUserCoverApi,
		onSuccess: (data) => {
			queryClient.setQueryData(["currentUser"], data);
			queryClient.setQueryData(["user", data.publicId], data);
			queryClient.setQueryData(["user", "publicId", data.publicId], data);
			queryClient.setQueryData(["user", "handle", data.handle], data);
			queryClient.setQueryData(["user", data.handle], data);

			// Invalidate all user-related queries to ensure consistency across the app
			queryClient.invalidateQueries({ queryKey: ["currentUser"] });
			queryClient.invalidateQueries({ queryKey: ["user"] });
			queryClient.invalidateQueries({ queryKey: ["userPosts", data.publicId] });
		},
	});
};

export const useEditUser = ()=> {
	const queryClient = useQueryClient();

	return useMutation<AuthenticatedUserDTO | AdminUserDTO, Error, { username?: string; bio?: string }>({
		mutationFn: editUserRequest,

		onSuccess: (data) => {
			queryClient.setQueryData(["currentUser"], data);
			queryClient.setQueryData(["user", data.publicId], data);
			queryClient.setQueryData(["user", "publicId", data.publicId], data);
			queryClient.setQueryData(["user", "handle", data.handle], data);
			queryClient.setQueryData(["user", data.handle], data);

			// Invalidate all user  queries
			queryClient.invalidateQueries({
				queryKey: ["user"],
			});
		},
	});
};

export const useChangePassword = () => {
	return useMutation<void, Error, { currentPassword: string; newPassword: string }>({
		mutationFn: changePasswordRequest,
	});
};

export const useFollowers = (userPublicId: string, options?: UseFollowListOptions) => {
	return useInfiniteQuery({
		queryKey: ["followers", userPublicId] as const,
		queryFn: ({ pageParam = 1 }) => fetchFollowers(userPublicId, pageParam as number),
		initialPageParam: 1,
		getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
		enabled: !!userPublicId,
		...options,
	});
};

export const useFollowing = (userPublicId: string, options?: UseFollowListOptions) => {
	return useInfiniteQuery({
		queryKey: ["following", userPublicId] as const,
		queryFn: ({ pageParam = 1 }) => fetchFollowing(userPublicId, pageParam as number),
		initialPageParam: 1,
		getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
		enabled: !!userPublicId,
		...options,
	});
};
