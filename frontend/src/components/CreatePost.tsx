import React, { useState, useRef, useMemo, useEffect } from "react";
import { Box, Avatar, Button, IconButton, Typography, Menu, MenuItem } from "@mui/material";
import {
	Image as ImageIcon,
	Close as CloseIcon,
	Public as PublicIcon,
	KeyboardArrowDown as KeyboardArrowDownIcon,
} from "@mui/icons-material";
import { useAuth } from "../hooks/context/useAuth";
import { useUploadPost } from "../hooks/posts/usePosts";
import { useUserCommunities } from "../hooks/communities/useCommunities";
import { useTranslation } from "react-i18next";
import { telemetry } from "../lib/telemetry";
import { LoadingSpinner } from "./LoadingSpinner";
import MentionInput from "./MentionInput";
import { devError } from "@/lib/devLogger";
import CharacterCounter, { POST_CHARACTER_LIMIT } from "./CharacterCounter";

interface CreatePostProps {
	compact?: boolean;
	onClose?: () => void; // optional callback when post is successfully created for usage in modal
	defaultCommunityPublicId?: string; // pre-select a community when posting from community page
}

const CreatePost: React.FC<CreatePostProps> = ({ onClose, defaultCommunityPublicId, compact = false }) => {
	const { t } = useTranslation();

	const { user, isLoggedIn } = useAuth();
	const uploadPostMutation = useUploadPost();

	const fileInputRef = useRef<HTMLInputElement>(null);

	const [file, setFile] = useState<File | null>(null);
	const [preview, setPreview] = useState<string>("");
	const [expanded, setExpanded] = useState(!compact);

	const [content, setContent] = useState<string>("");
	const [tags, setTags] = useState<string[]>([]);

	// community selection state - null means personal post, string means community post
	const [selectedCommunityPublicId, setSelectedCommunityPublicId] = useState<string | null>(
		defaultCommunityPublicId || null,
	);

	// Audience selector menu state
	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
	const open = Boolean(anchorEl);

	const handleAudienceClick = (event: React.MouseEvent<HTMLElement>) => {
		setAnchorEl(event.currentTarget);
	};

	const handleAudienceClose = () => {
		setAnchorEl(null);
	};

	const handleCommunitySelect = (communityId: string | null) => {
		setSelectedCommunityPublicId(communityId);
		handleAudienceClose();
	};

	// flow tracking for telemetry
	const flowIdRef = useRef<string | null>(null);
	const hasStartedFlow = content.trim().length > 0 || file !== null;

	useEffect(() => {
		if (hasStartedFlow && !flowIdRef.current) {
			flowIdRef.current = telemetry.startFlow("create_post", {
				hasCommunity: !!selectedCommunityPublicId,
			});
		}
	}, [hasStartedFlow, selectedCommunityPublicId]);

	// cleanup on unmount
	useEffect(() => {
		return () => {
			if (flowIdRef.current) {
				telemetry.abandonFlow(flowIdRef.current, "unmount");
			}
		};
	}, []);

	// fetch user's communities for the dropdown
	const { data: communitiesData, isLoading: isLoadingCommunities } = useUserCommunities(isLoggedIn);

	const userCommunities = useMemo(() => {
		return communitiesData?.pages.flatMap((page) => page.data) ?? [];
	}, [communitiesData]);

	const selectedCommunity = useMemo(() => {
		if (!selectedCommunityPublicId) return null;
		return userCommunities.find((c) => c.publicId === selectedCommunityPublicId) || null;
	}, [selectedCommunityPublicId, userCommunities]);

	const BASE_URL = "/api";
	const avatarPath = user?.avatar || "";
	const fullAvatarUrl = avatarPath.startsWith("http")
		? avatarPath
		: avatarPath.startsWith("/")
			? `${BASE_URL}${avatarPath}`
			: avatarPath
				? `${BASE_URL}/${avatarPath}`
				: undefined;

	if (!isLoggedIn) {
		return null;
	}

	if (isLoadingCommunities) {
		return <LoadingSpinner />;
	}

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files[0]) {
			const selectedFile = e.target.files[0];
			setFile(selectedFile);

			//image preview
			const reader = new FileReader();
			reader.onload = (e) => {
				setPreview(e.target?.result as string);
			};
			reader.readAsDataURL(selectedFile);
		}
	};

	const handleUpload = async () => {
		if (content.length > POST_CHARACTER_LIMIT || uploadPostMutation.isPending) return;
		if (!content.trim() && !tags.length) {
			alert(t("interests.caption_required"));
			return;
		}

		const formData = new FormData();

		if (file) {
			formData.append("image", file);
		}
		if (content.trim()) {
			formData.append("body", content.trim());
		}
		formData.append("tags", JSON.stringify(tags));

		// add community selection if posting to a community
		if (selectedCommunityPublicId) {
			formData.append("communityPublicId", selectedCommunityPublicId);
		}

		try {
			await uploadPostMutation.mutateAsync(formData);

			// complete telemetry flow on success
			if (flowIdRef.current) {
				telemetry.completeFlow(flowIdRef.current, {
					hasImage: !!file,
					hasText: !!content.trim(),
					hasCommunity: !!selectedCommunityPublicId,
					tagCount: tags.length,
				});
				flowIdRef.current = null;
			}

			setContent("");
			setTags([]);
			setFile(null);
			setPreview("");
			if (compact) setExpanded(false);
			setSelectedCommunityPublicId(defaultCommunityPublicId || null);
			if (fileInputRef.current) fileInputRef.current.value = "";

			if (onClose) {
				onClose();
			}
		} catch (error) {
			devError("Upload failed:", error);
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.ctrlKey && e.key === "Enter" && !isDisabled) {
			e.preventDefault();
			handleUpload();
		}
	};

	const isDisabled = (!content.trim() && !tags.length) || content.length > POST_CHARACTER_LIMIT || uploadPostMutation.isPending;
	if (compact && !expanded) {
		return <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
			<Avatar src={fullAvatarUrl} alt={user?.username} sx={{ width: 42, height: 42 }}>{user?.username?.charAt(0)}</Avatar>
			<Button onClick={() => setExpanded(true)} onFocus={() => setExpanded(true)} aria-label={t("timeline.placeholder")}
				sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left", px: 0, color: "text.secondary", fontSize: { xs: "1rem", sm: "1.125rem" }, fontWeight: 400 }}>
				{content.trim() ? t("timeline.continue_draft") : t("timeline.placeholder")}
			</Button>
			<Button variant="contained" onClick={() => setExpanded(true)} sx={{ borderRadius: 3, minWidth: 72, py: 1.25 }}>{t("post.post_button")}</Button>
		</Box>;
	}

	return (
		<Box
			sx={{
				p: 0,
			}}
		>
			<Box sx={{ display: "flex", gap: 1.25 }}>
				<Avatar
					src={fullAvatarUrl}
					alt={user?.username}
					sx={{
						width: 36,
						height: 36,
					}}
				/>
				<Box sx={{ flex: 1, minWidth: 0, position: "relative", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", columnGap: 1 }}>
					{/* Audience Selector Pill */}
					<Button
						onClick={handleAudienceClick}
						endIcon={<KeyboardArrowDownIcon fontSize="small" />}
						sx={{
							gridColumn: compact ? "1" : "1 / -1",
							justifySelf: "start",
							color: "primary.main",
							border: "1px solid",
							borderColor: "divider",
							borderRadius: 20,
							textTransform: "none",
							fontWeight: 600,
							fontSize: "0.875rem",
							mb: 0.5,
							height: 24,
							px: 1.5,
							"&:hover": {
								bgcolor: "rgba(29, 155, 240, 0.1)",
								borderColor: "primary.main",
							},
						}}
					>
						{selectedCommunity ? selectedCommunity.name : "Everyone"}
					</Button>

					{/* Audience Menu */}
					<Menu
						anchorEl={anchorEl}
						open={open}
						onClose={handleAudienceClose}
						PaperProps={{
							sx: {
								maxHeight: 300,
								width: 280,
								borderRadius: 4,
								mt: 1,
								boxShadow: "rgb(101 119 134 / 20%) 0px 0px 15px, rgb(101 119 134 / 15%) 0px 0px 3px 1px",
							},
						}}
					>
						<Typography variant="subtitle2" sx={{ px: 2, py: 1, fontWeight: 700 }}>
							Choose audience
						</Typography>
						<MenuItem onClick={() => handleCommunitySelect(null)} selected={!selectedCommunity}>
							<Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
								<Avatar sx={{ bgcolor: "primary.main", width: 32, height: 32 }}>
									<PublicIcon fontSize="small" />
								</Avatar>
								<Typography fontWeight={600}>Everyone</Typography>
							</Box>
						</MenuItem>

						{userCommunities.length > 0 && (
							<>
								<Typography variant="subtitle2" sx={{ px: 2, py: 1, mt: 1, fontWeight: 700 }}>
									My Communities
								</Typography>
								{userCommunities.map((community) => (
									<MenuItem
										key={community.publicId}
										onClick={() => handleCommunitySelect(community.publicId)}
										selected={selectedCommunity?.publicId === community.publicId}
									>
										<Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
											<Avatar src={community.avatar} sx={{ width: 32, height: 32 }}>
												{community.name.charAt(0)}
											</Avatar>
											<Typography fontWeight={600}>{community.name}</Typography>
										</Box>
									</MenuItem>
								))}
							</>
						)}
					</Menu>
					{compact && <IconButton aria-label={t("timeline.close_composer")} onClick={() => setExpanded(false)}
						sx={{ gridColumn: 2, gridRow: 1, justifySelf: "end", width: 32, height: 32 }}><CloseIcon fontSize="small" /></IconButton>}

					<Box sx={{ gridColumn: "1 / -1", minWidth: 0 }}>
						<MentionInput
							value={content}
							onChange={setContent}
							onKeyDown={handleKeyDown}
							placeholder={t(compact ? "timeline.placeholder" : "post.placeholder")}
							multiline
							autoFocus={compact && expanded}
							minRows={1}
							maxLength={POST_CHARACTER_LIMIT}
							sx={{
								fontSize: "1rem",
								lineHeight: 1.5,
								border: "none",
								backgroundColor: "transparent",
								"&:hover": {
									backgroundColor: "transparent",
									borderColor: "transparent",
								},
								"&:focus-within": {
									backgroundColor: "transparent",
									borderColor: "transparent",
								},
							}}
						/>
					</Box>

					{/* Image Preview */}
					{file && !content.trim() && !tags.length && <Typography variant="body2" color="warning.main" sx={{ my: 1, gridColumn: "1 / -1" }}>
            {t("interests.caption_required")}
          </Typography>}
					{preview && (
						<Box sx={{ mt: 1, mb: 1, position: "relative", gridColumn: "1 / -1" }}>
							<img
								src={preview}
								alt={t("post.preview")}
								style={{
									width: "100%",
									maxHeight: "300px",
									objectFit: "cover",
									borderRadius: "10px",
								}}
							/>
							<IconButton
								onClick={() => {
									setPreview("");
									setFile(null);
									if (fileInputRef.current) fileInputRef.current.value = "";
								}}
								sx={{
									position: "absolute",
									top: 8,
									right: 8,
									backgroundColor: "rgba(0, 0, 0, 0.5)",
									color: "white",
									"&:hover": {
										backgroundColor: "rgba(0, 0, 0, 0.7)",
									},
								}}
								size="small"
								aria-label="Remove selected image"
							>
								<CloseIcon fontSize="small" />
							</IconButton>
						</Box>
					)}

					<Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0.75, color: "primary.main", minWidth: 0 }}>
						<Box sx={{ display: "flex", gap: 0.5 }}>
							<IconButton
								aria-label="Add image"
								onClick={() => fileInputRef.current?.click()}
								sx={{
									color: "primary.main",
									"&:hover": {
										backgroundColor: "rgba(29, 155, 240, 0.1)",
									},
								}}
								size="small"
							>
								<ImageIcon fontSize="small" />
							</IconButton>
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								style={{ display: "none" }}
								onChange={handleFileChange}
							/>
						</Box>
						<PublicIcon fontSize="small" sx={{ fontSize: 16 }} />
						<Typography variant="caption" fontWeight={600} sx={{ color: "primary.main" }}>
							{selectedCommunity ? "Community members can reply" : "Everyone can reply"}
						</Typography>
					</Box>

					<Box
						sx={{
							display: "flex",
							justifyContent: "flex-end",
							alignItems: "flex-end",
							flexDirection: "column",
							gap: 1,
						}}
					>
						<CharacterCounter value={content} limit={POST_CHARACTER_LIMIT} />
						<Button
							variant="contained"
							onClick={handleUpload}
							disabled={isDisabled}
							sx={{
								borderRadius: 2,
								textTransform: "none",
								fontWeight: 700,
								px: 2.5,
								py: 0.5,
								bgcolor: "primary.main",
								boxShadow: "none",
								"&:hover": {
									bgcolor: "primary.dark",
									boxShadow: "none",
								},
								"&:disabled": {
									opacity: 0.5,
									bgcolor: "primary.main",
									color: "primary.contrastText",
								},
							}}
						>
							{uploadPostMutation.isPending ? t("post.posting") : t("post.post_button")}
						</Button>
					</Box>
				</Box>
			</Box>
		</Box>
	);
};

export default CreatePost;
