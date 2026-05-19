import React, { useEffect, useRef, useMemo } from "react";
import { Box, Typography, Avatar, CircularProgress, IconButton, Chip } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import PersonRemoveIcon from "@mui/icons-material/PersonRemove";
import { useNavigate, useParams } from "react-router-dom";
import { useCommunityMembers } from "../hooks/communities/useCommunityMembers";
import { useCommunity, useKickMember } from "../hooks/communities/useCommunity";
import { useAuth } from "../hooks/context/useAuth";

const CommunityMembers: React.FC = () => {
	const navigate = useNavigate();
	const { slug } = useParams<{ slug: string }>();
	const { user } = useAuth();

	const { data: community } = useCommunity(slug);
	const { mutate: kickMember, isPending: isKicking } = useKickMember();

	const { data: membersData, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useCommunityMembers(slug);

	const members = useMemo(() => {
		return membersData?.pages.flatMap((page) => page.data) || [];
	}, [membersData]);

	const observerTarget = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
					fetchNextPage();
				}
			},
			{ threshold: 0.1 }
		);

		if (observerTarget.current) {
			observer.observe(observerTarget.current);
		}

		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const handleKick = (e: React.MouseEvent, userId: string) => {
		e.stopPropagation();
		if (window.confirm("Are you sure you want to kick this member?")) {
			kickMember({ communityId: community!.publicId, userId });
		}
	};

	const getAvatarUrl = (avatar?: string) => {
		if (!avatar) return undefined;
		return avatar.startsWith("http") ? avatar : `/api/${avatar}`;
	};

	return (
		<Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
			{/* Header */}
			<Box
				sx={{
					position: "sticky",
					top: 0,
					zIndex: 10,
					bgcolor: "rgba(0, 0, 0, 0.65)",
					backdropFilter: "blur(12px)",
					borderBottom: "1px solid",
					borderColor: "divider",
					px: 2,
					py: 1,
					display: "flex",
					alignItems: "center",
					gap: 3,
				}}
			>
				<IconButton onClick={() => navigate(-1)} sx={{ color: "text.primary" }}>
					<ArrowBackIcon />
				</IconButton>
				<Box>
					<Typography variant="h6" fontWeight={800}>
						{community?.name || "Community Members"}
					</Typography>
					<Typography variant="caption" color="text.secondary">
						@{slug}
					</Typography>
				</Box>
			</Box>

			{/* Members List */}
			<Box>
				{isLoading ? (
					<Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
						<CircularProgress />
					</Box>
				) : (
					members.map((member) => (
						<Box
							key={`${member.userId.publicId}-${member.role}-${member.joinedAt}`}
							sx={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								p: 2,
								cursor: "pointer",
								"&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
								borderBottom: "1px solid",
								borderColor: "divider",
							}}
							onClick={() => navigate(`/profile/${member.userId.handle || member.userId.publicId}`)}
						>
							<Box sx={{ display: "flex", alignItems: "center" }}>
								<Avatar
									src={getAvatarUrl(member.userId.avatar)}
									alt={member.userId.username}
									sx={{ width: 48, height: 48, mr: 2 }}
								>
									{member.userId.username?.charAt(0).toUpperCase()}
								</Avatar>
								<Box>
									<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
										<Typography variant="subtitle1" fontWeight={700}>
											{member.userId.username}
										</Typography>
										{member.role === "admin" && (
											<Chip
												icon={<AdminPanelSettingsIcon sx={{ fontSize: 16 }} />}
												label="Admin"
												size="small"
												color="primary"
												variant="outlined"
												sx={{ height: 20, fontSize: "0.7rem" }}
											/>
										)}
									</Box>
									<Typography variant="body2" color="text.secondary">
										@{member.userId.handle || member.userId.username}
									</Typography>
								</Box>
							</Box>

							{community?.isCreator && member.userId.publicId !== user?.publicId && (
								<IconButton
									color="error"
									onClick={(e) => handleKick(e, member.userId.publicId)}
									disabled={isKicking}
									size="small"
									title="Kick member"
								>
									<PersonRemoveIcon />
								</IconButton>
							)}
						</Box>
					))
				)}

				{/* Infinite Scroll Loader */}
				<div ref={observerTarget} style={{ height: 20, margin: "10px 0" }}>
					{isFetchingNextPage && (
						<Box sx={{ display: "flex", justifyContent: "center" }}>
							<CircularProgress size={24} />
						</Box>
					)}
				</div>
			</Box>
		</Box>
	);
};

export default CommunityMembers;
