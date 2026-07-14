import React, { useEffect, useRef, useMemo, useState } from "react";
import {
	Box,
	Typography,
	Avatar,
	CircularProgress,
	alpha,
	useTheme,
	IconButton,
	Button,
	Tabs,
	Tab,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useFollowers, useFollowing, useGetUser } from "../hooks/user/useUsers";
import { useFollowUser } from "../hooks/user/useUserAction";
import { useAuth } from "../hooks/context/useAuth";
import { FollowUserItem } from "../api/userApi";
import { buildAvatarUrl } from "../lib/media";

const FollowList: React.FC = () => {
	const theme = useTheme();
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const [searchParams] = useSearchParams();
	const initialTab = searchParams.get("tab") === "following" ? 1 : 0;
	const [activeTab, setActiveTab] = useState(initialTab);

	const { user: currentUser } = useAuth();

	// fetch the user whose followers/following we're viewing
	const { data: profileUser, isLoading: isLoadingUser } = useGetUser(id);

	const {
		data: followersData,
		fetchNextPage: fetchNextFollowers,
		hasNextPage: hasNextFollowers,
		isFetchingNextPage: isFetchingNextFollowers,
		isLoading: isLoadingFollowers,
	} = useFollowers(profileUser?.publicId || "", { enabled: !!profileUser?.publicId && activeTab === 0 });

	const {
		data: followingData,
		fetchNextPage: fetchNextFollowing,
		hasNextPage: hasNextFollowing,
		isFetchingNextPage: isFetchingNextFollowing,
		isLoading: isLoadingFollowing,
	} = useFollowing(profileUser?.publicId || "", { enabled: !!profileUser?.publicId && activeTab === 1 });

	const followMutation = useFollowUser();

	// track follow state for each user
	const [followStates, setFollowStates] = useState<Record<string, boolean>>({});

	const followers = useMemo(() => {
		return followersData?.pages.flatMap((page) => page.users) || [];
	}, [followersData]);

	const following = useMemo(() => {
		return followingData?.pages.flatMap((page) => page.users) || [];
	}, [followingData]);

	const observerTarget = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					if (activeTab === 0 && hasNextFollowers && !isFetchingNextFollowers) {
						fetchNextFollowers();
					} else if (activeTab === 1 && hasNextFollowing && !isFetchingNextFollowing) {
						fetchNextFollowing();
					}
				}
			},
			{ threshold: 0.1 }
		);

		if (observerTarget.current) {
			observer.observe(observerTarget.current);
		}

		return () => observer.disconnect();
	}, [
		activeTab,
		hasNextFollowers,
		hasNextFollowing,
		isFetchingNextFollowers,
		isFetchingNextFollowing,
		fetchNextFollowers,
		fetchNextFollowing,
	]);

	const handleFollowToggle = (userPublicId: string) => {
		followMutation.mutate(userPublicId, {
			onSuccess: () => {
				setFollowStates((prev) => ({
					...prev,
					[userPublicId]: !prev[userPublicId],
				}));
			},
		});
	};

	const handleUserClick = (handle: string | undefined, publicId: string) => {
		const identifier = handle || publicId;
		navigate(`/profile/${identifier}`);
	};

	const renderUserList = (users: FollowUserItem[], isLoading: boolean, isFetchingNext: boolean) => {
		if (isLoading && users.length === 0) {
			return (
				<Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
					<CircularProgress size={32} />
				</Box>
			);
		}

		if (users.length === 0) {
			return (
				<Box sx={{ textAlign: "center", py: 6 }}>
					<Typography color="text.secondary">
						{activeTab === 0 ? "No followers yet" : "Not following anyone yet"}
					</Typography>
				</Box>
			);
		}

		return (
			<>
				{users.map((user) => {
					const isCurrentUser = currentUser?.publicId === user.publicId;
					const isFollowing = followStates[user.publicId] ?? false;

					return (
						<Box
							key={user.publicId}
							sx={{
								display: "flex",
								alignItems: "center",
								gap: 2,
								p: 2,
								borderBottom: `1px solid ${theme.palette.divider}`,
								cursor: "pointer",
								transition: "background-color 0.2s",
								"&:hover": {
									bgcolor: alpha(theme.palette.text.primary, 0.03),
								},
							}}
							onClick={() => handleUserClick(user.handle, user.publicId)}
						>
							<Avatar src={buildAvatarUrl(user.avatar, 48)} alt={user.username} sx={{ width: 48, height: 48 }}>
								{user.username?.charAt(0).toUpperCase()}
							</Avatar>

							<Box sx={{ flex: 1, minWidth: 0 }}>
								<Typography
									variant="body1"
									fontWeight={700}
									sx={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{user.username}
								</Typography>
								<Typography
									variant="body2"
									color="text.secondary"
									sx={{
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									@{user.handle}
								</Typography>
								{user.bio && (
									<Typography
										variant="body2"
										color="text.secondary"
										sx={{
											mt: 0.5,
											overflow: "hidden",
											textOverflow: "ellipsis",
											display: "-webkit-box",
											WebkitLineClamp: 2,
											WebkitBoxOrient: "vertical",
										}}
									>
										{user.bio}
									</Typography>
								)}
							</Box>

							{!isCurrentUser && currentUser && (
								<Button
									variant={isFollowing ? "outlined" : "contained"}
									size="small"
									onClick={(e) => {
										e.stopPropagation();
										handleFollowToggle(user.publicId);
									}}
									disabled={followMutation.isPending}
									sx={{
										borderRadius: 9999,
										textTransform: "none",
										fontWeight: 700,
										minWidth: 100,
										bgcolor: isFollowing ? "transparent" : "common.white",
										color: isFollowing ? "text.primary" : "common.black",
										borderColor: isFollowing ? "divider" : "transparent",
										"&:hover": {
											bgcolor: isFollowing
												? alpha(theme.palette.error.main, 0.1)
												: alpha(theme.palette.common.white, 0.9),
											color: isFollowing ? "error.main" : "common.black",
											borderColor: isFollowing ? "error.main" : "transparent",
										},
									}}
								>
									{isFollowing ? "Unfollow" : "Follow"}
								</Button>
							)}
						</Box>
					);
				})}

				{/* infinite scroll trigger */}
				<div ref={observerTarget} style={{ height: 20 }} />

				{isFetchingNext && (
					<Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
						<CircularProgress size={24} />
					</Box>
				)}
			</>
		);
	};

	if (isLoadingUser) {
		return (
			<Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
				<CircularProgress />
			</Box>
		);
	}

	return (
		<Box sx={{ maxWidth: 600, mx: "auto" }}>
			{/* header */}
			<Box
				sx={{
					position: "sticky",
					top: 0,
					bgcolor: "rgba(0, 0, 0, 0.65)",
					backdropFilter: "blur(12px)",
					borderBottom: `1px solid ${theme.palette.divider}`,
					zIndex: 10,
					px: 2,
					py: 1,
				}}
			>
				<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
					<IconButton
						onClick={() => navigate(-1)}
						sx={{
							color: "text.primary",
							"&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.1) },
						}}
					>
						<ArrowBackIcon />
					</IconButton>
					<Box>
						<Typography variant="h6" fontWeight={700}>
							{profileUser?.username || "User"}
						</Typography>
						<Typography variant="body2" color="text.secondary">
							@{profileUser?.handle}
						</Typography>
					</Box>
				</Box>

				{/* tabs */}
				<Tabs
					value={activeTab}
					onChange={(_, newValue) => setActiveTab(newValue)}
					variant="fullWidth"
					textColor="inherit"
					indicatorColor="primary"
					sx={{
						mt: 1,
						"& .MuiTab-root": {
							textTransform: "none",
							fontWeight: 700,
							fontSize: "0.95rem",
							minHeight: 48,
							color: "text.secondary",
							"&:hover": {
								bgcolor: alpha(theme.palette.text.primary, 0.1),
							},
							"&.Mui-selected": {
								color: "text.primary",
							},
						},
					}}
				>
					<Tab label={`Followers`} />
					<Tab label={`Following`} />
				</Tabs>
			</Box>

			{/* content */}
			<Box>
				{activeTab === 0 && renderUserList(followers, isLoadingFollowers, isFetchingNextFollowers)}
				{activeTab === 1 && renderUserList(following, isLoadingFollowing, isFetchingNextFollowing)}
			</Box>
		</Box>
	);
};

export default FollowList;
