import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
	Avatar,
	Box,
	Button,
	CircularProgress,
	Fab,
	IconButton,
	List,
	ListItemAvatar,
	ListItemButton,
	ListItemText,
	Paper,
	TextField,
	Typography,
	useMediaQuery,
	useTheme,
	alpha,
	Menu,
	MenuItem,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogContentText,
	DialogActions,
	Input,
	Badge,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import ArrowBackIosNewRoundedIcon from "@mui/icons-material/ArrowBackIosNewRounded";
import {
	InfoOutlined as InfoOutlinedIcon,
	Image as ImageIcon,
	Gif as GifIcon,
	EmojiEmotions as EmojiEmotionsIcon,
	CheckCircle as CheckCircleIcon,
	Done as DoneIcon,
	Delete as DeleteIcon,
	Edit as EditIcon,
	Cancel as CancelIcon,
	Close as CloseIcon,
	KeyboardArrowDown as KeyboardArrowDownIcon,
} from "@mui/icons-material";
import { useConversations } from "../hooks/messaging/useConversations";
import { useConversationMessages } from "../hooks/messaging/useConversationMessages";
import { useSendMessage } from "../hooks/messaging/useSendMessage";
import { useMarkConversationRead } from "../hooks/messaging/useMarkConversationRead";
import { useEditMessage } from "../hooks/messaging/useEditMessage";
import { useDeleteMessage } from "../hooks/messaging/useDeleteMessage";
import { useAuth } from "../hooks/context/useAuth";
import { useSocket } from "../hooks/context/useSocket";
import { ConversationSummaryDTO, MessageDTO } from "../types";

const CONVERSATION_PANEL_WIDTH = 380;

const formatTimestamp = (timestamp: string) => {
	try {
		const date = new Date(timestamp);
		return new Intl.DateTimeFormat("en", {
			hour: "numeric",
			minute: "numeric",
			month: "short",
			day: "numeric",
		}).format(date);
	} catch {
		return timestamp;
	}
};

const getConversationTitle = (conversation: ConversationSummaryDTO, currentUserId?: string | null) => {
	if (conversation.title) {
		return conversation.title;
	}

	const others = conversation.participants.filter((participant) => participant.publicId !== currentUserId);
	if (others.length === 0 && conversation.participants.length > 0) {
		return conversation.participants[0].username;
	}

	const label = others.map((participant) => participant.username).join(", ");
	return label || "Direct Message";
};

const getOtherParticipant = (conversation: ConversationSummaryDTO, currentUserId?: string | null) => {
	const others = conversation.participants.filter((participant) => participant.publicId !== currentUserId);
	// return the first other participant, or null if somehow there are none
	return others[0] || null;
};

const getConversationAvatar = (conversation: ConversationSummaryDTO, currentUserId?: string | null) => {
	const other = getOtherParticipant(conversation, currentUserId);
	// only return the other participant's avatar, never fall back to current user's avatar
	return other?.avatar || "";
};

const Messages = () => {
	const theme = useTheme();
	const location = useLocation();
	const navigate = useNavigate();
	const isMobile = useMediaQuery(theme.breakpoints.down("md"));
	const [draftBody, setDraftBody] = useState("");
	const { user } = useAuth();
	const socket = useSocket();
	const messagesContainerRef = useRef<HTMLDivElement | null>(null);
	const markedAsReadRef = useRef<Set<string>>(new Set());
	const markReadPendingRef = useRef<Set<string>>(new Set());
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
	const [selectedMessage, setSelectedMessage] = useState<MessageDTO | null>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
	const [imageFile, setImageFile] = useState<File | null>(null);

	// scroll position tracking for "new messages" indicator
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [newMessageCount, setNewMessageCount] = useState(0);
	const lastSeenMessageIdRef = useRef<string | null>(null);

	const conversationsQuery = useConversations();

	const conversations = useMemo(
		() => conversationsQuery.data?.pages.flatMap((p) => p.conversations) ?? [],
		[conversationsQuery.data],
	);

	const selectedConversationId = useMemo(() => {
		const params = new URLSearchParams(location.search);
		return params.get("conversation");
	}, [location.search]);

	// notify backend when viewing a conversation to suppress notifications
	useEffect(() => {
		if (!socket) return;

		if (selectedConversationId) {
			socket.emit("conversation_opened", selectedConversationId);
		}

		return () => {
			if (selectedConversationId) {
				socket.emit("conversation_closed", selectedConversationId);
			}
		};
	}, [selectedConversationId, socket]);

	const firstConversationId = conversations[0]?.publicId;

	useEffect(() => {
		if (!selectedConversationId && firstConversationId && !isMobile) {
			navigate(`?conversation=${firstConversationId}`, { replace: true });
		}
	}, [firstConversationId, selectedConversationId, navigate, isMobile]);

	const markConversationRead = useMarkConversationRead();
	const selectedConversation = useMemo(() => {
		return conversations.find((c) => c.publicId === selectedConversationId);
	}, [conversations, selectedConversationId]);

	useEffect(() => {
		if (
			selectedConversation &&
			selectedConversation.unreadCount > 0 &&
			!markedAsReadRef.current.has(selectedConversation.publicId) &&
			!markReadPendingRef.current.has(selectedConversation.publicId)
		) {
			markReadPendingRef.current.add(selectedConversation.publicId);
			markConversationRead.mutate(selectedConversation.publicId, {
				onSuccess: () => {
					markReadPendingRef.current.delete(selectedConversation.publicId);
					markedAsReadRef.current.add(selectedConversation.publicId);
				},
				onError: () => {
					markReadPendingRef.current.delete(selectedConversation.publicId);
					markedAsReadRef.current.delete(selectedConversation.publicId);
				},
			});
		}
		// reset tracking when conversation changes or unread count goes to 0
		if (selectedConversation && selectedConversation.unreadCount === 0) {
			markedAsReadRef.current.delete(selectedConversation.publicId);
			markReadPendingRef.current.delete(selectedConversation.publicId);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedConversation?.publicId, selectedConversation?.unreadCount]);

	const messagesQuery = useConversationMessages(selectedConversationId);

	const messages = useMemo(() => {
		const pages = messagesQuery.data?.pages ?? [];
		const flattened = pages.flatMap((page) => page.messages);
		const sorted = [...flattened].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
		return sorted;
	}, [messagesQuery.data?.pages]);

	// get the last message id to track new messages
	const lastMessageId = messages.length > 0 ? messages[messages.length - 1]?.publicId : null;

	// helper to scroll to bottom
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		if (messagesContainerRef.current) {
			messagesContainerRef.current.scrollTo({
				top: messagesContainerRef.current.scrollHeight,
				behavior,
			});
		}
	}, []);

	// check if scroll is at bottom (within threshold)
	const checkIfAtBottom = useCallback(() => {
		if (!messagesContainerRef.current) return true;
		const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
		const threshold = 100; // px from bottom to consider "at bottom"
		return scrollHeight - scrollTop - clientHeight < threshold;
	}, []);

	// handle scroll events to track position
	const handleScroll = useCallback(() => {
		const atBottom = checkIfAtBottom();
		setIsAtBottom(atBottom);
		if (atBottom) {
			setNewMessageCount(0);
			lastSeenMessageIdRef.current = lastMessageId;
		}
	}, [checkIfAtBottom, lastMessageId]);

	// scroll to bottom when conversation changes
	useEffect(() => {
		if (!selectedConversationId) return;
		setNewMessageCount(0);
		setIsAtBottom(true);
		lastSeenMessageIdRef.current = null;
		
		const timeoutId = setTimeout(() => {
			scrollToBottom();
		}, 100);
		
		return () => clearTimeout(timeoutId);
	}, [selectedConversationId, scrollToBottom]);

	// handle new messages - only auto-scroll if already at bottom
	useEffect(() => {
		if (!lastMessageId || messages.length === 0) return;

		// initial load - scroll to bottom
		if (lastSeenMessageIdRef.current === null) {
			lastSeenMessageIdRef.current = lastMessageId;
			setTimeout(() => scrollToBottom(), 50);
			return;
		}

		// new message arrived
		if (lastSeenMessageIdRef.current !== lastMessageId) {
			const lastMessage = messages[messages.length - 1];
			const isOwnMessage = lastMessage?.sender?.publicId === user?.publicId;

			if (isAtBottom || isOwnMessage) {
				// at bottom or sent by user - scroll to bottom
				lastSeenMessageIdRef.current = lastMessageId;
				setTimeout(() => scrollToBottom("smooth"), 50);
			} else {
				// not at bottom - increment new message count
				setNewMessageCount((prev) => prev + 1);
			}
		}
	}, [lastMessageId, messages, isAtBottom, scrollToBottom, user?.publicId]);

	// click handler for "new messages" button
	const handleScrollToNewMessages = useCallback(() => {
		scrollToBottom("smooth");
		setNewMessageCount(0);
		lastSeenMessageIdRef.current = lastMessageId;
	}, [scrollToBottom, lastMessageId]);

	const sendMessage = useSendMessage();
	const editMessage = useEditMessage();
	const deleteMessage = useDeleteMessage();

	const handleSelectConversation = (conversationId: string) => {
		navigate(`?conversation=${conversationId}`);
	};

	const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if ((!draftBody.trim() && !imageFile) || !selectedConversationId) return;

		if (isEditing && selectedMessage) {
			await editMessage.mutateAsync({ messageId: selectedMessage.publicId, body: draftBody.trim() });
			setIsEditing(false);
			setSelectedMessage(null);
		} else {
			const payload = new FormData();
			payload.append("conversationPublicId", selectedConversationId);
			payload.append("body", draftBody.trim());
			if (imageFile) {
				payload.append("image", imageFile);
			}

			await sendMessage.mutateAsync(payload);
		}

		setDraftBody("");
		setImageFile(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const handleBackToList = () => {
		navigate("/messages");
	};

	const handleMenuOpen = (event: React.MouseEvent<HTMLDivElement>, message: MessageDTO) => {
		event.preventDefault();
		if (message.sender.publicId !== user?.publicId) return;
		setAnchorEl(event.currentTarget);
		setSelectedMessage(message);
	};

	const handleMenuClose = () => {
		setAnchorEl(null);
		setSelectedMessage(null);
	};

	const handleEditStart = () => {
		if (selectedMessage) {
			setDraftBody(selectedMessage.body);
			setIsEditing(true);
		}
		setAnchorEl(null);
	};

	const handleDeleteStart = () => {
		setDeleteConfirmationOpen(true);
		setAnchorEl(null);
	};

	const handleDeleteConfirm = async () => {
		if (selectedMessage && selectedConversationId) {
			await deleteMessage.mutateAsync({
				messageId: selectedMessage.publicId,
				conversationId: selectedConversationId,
			});
		}
		setDeleteConfirmationOpen(false);
		setSelectedMessage(null);
	};

	const handleCancelEdit = () => {
		setIsEditing(false);
		setDraftBody("");
		setSelectedMessage(null);
	};

	const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
		if (event.target.files && event.target.files[0]) {
			setImageFile(event.target.files[0]);
		}
	};

	const handleRemoveImage = () => {
		setImageFile(null);
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	const renderMessageBubble = (message: MessageDTO) => {
		const isOwnMessage = message.sender.publicId === user?.publicId;
		const statusLabel = message.status === "read" ? "Read" : message.status === "delivered" ? "Delivered" : "Sent";
		const statusColor = message.status === "read" ? "primary.main" : "text.secondary";
		const statusIcon =
			message.status === "read" ? (
				<CheckCircleIcon sx={{ fontSize: 12, color: statusColor }} />
			) : (
				<DoneIcon sx={{ fontSize: 12, color: statusColor }} />
			);

		const hasImage = message.attachments && message.attachments.length > 0 && message.attachments[0].type === "image";
		const hasText = message.body && message.body.trim().length > 0;

		return (
			<Box
				key={message.publicId}
				sx={{
					display: "flex",
					flexDirection: "column",
					alignItems: isOwnMessage ? "flex-end" : "flex-start",
					mb: 2,
					maxWidth: "100%",
				}}
			>
				{/* Image Only Message */}
				{hasImage && !hasText ? (
					<Box
						onContextMenu={(e) => handleMenuOpen(e, message)}
						sx={{
							position: "relative",
							maxWidth: "70%",
							cursor: isOwnMessage ? "pointer" : "default",
						}}
					>
						<Box
							component="img"
							src={message.attachments![0].url}
							alt="attachment"
							sx={{
								maxWidth: "100%",
								maxHeight: 300,
								borderRadius: 4,
								display: "block",
								boxShadow: 2,
							}}
						/>
						{/* Timestamp overlay for image-only */}
						<Box
							sx={{
								position: "absolute",
								bottom: 8,
								right: 8,
								bgcolor: "rgba(0,0,0,0.5)",
								borderRadius: 2,
								px: 0.75,
								py: 0.25,
								display: "flex",
								alignItems: "center",
								gap: 0.5,
								backdropFilter: "blur(2px)",
							}}
						>
							<Typography variant="caption" sx={{ color: "white", fontSize: "0.7rem", fontWeight: 500 }}>
								{formatTimestamp(message.createdAt)}
							</Typography>
							{isOwnMessage && statusLabel && (
								<Box sx={{ display: "flex", alignItems: "center" }}>
									{message.status === "read" ? (
										<CheckCircleIcon sx={{ fontSize: 10, color: "white" }} />
									) : (
										<DoneIcon sx={{ fontSize: 10, color: "white" }} />
									)}
								</Box>
							)}
						</Box>
					</Box>
				) : (
					/* Text (with optional Image) Message */
					<>
						<Box
							onContextMenu={(e) => handleMenuOpen(e, message)}
							sx={{
								maxWidth: "70%",
								px: 2,
								py: 1.5,
								borderRadius: isOwnMessage ? "22px 22px 4px 22px" : "22px 22px 22px 4px",
								bgcolor: isOwnMessage ? "primary.main" : alpha(theme.palette.text.primary, 0.05),
								color: isOwnMessage ? "#fff" : "text.primary",
								position: "relative",
								wordBreak: "break-word",
								boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
								cursor: isOwnMessage ? "pointer" : "default",
							}}
						>
							{hasImage && (
								<Box
									component="img"
									src={message.attachments![0].url}
									alt="attachment"
									sx={{
										maxWidth: "100%",
										maxHeight: 200,
										borderRadius: 2,
										mb: 1,
										display: "block",
									}}
								/>
							)}
							<Typography
								variant="body1"
								sx={{
									fontSize: "0.95rem",
									lineHeight: 1.5,
									fontStyle: message.body === "message delete by user" ? "italic" : "normal",
									color:
										message.body === "message delete by user"
											? isOwnMessage
												? "rgba(255,255,255,0.7)"
												: "text.secondary"
											: "inherit",
								}}
							>
								{message.body}
							</Typography>
						</Box>
						<Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5, px: 1 }}>
							<Typography
								variant="caption"
								sx={{
									color: "text.secondary",
									fontSize: "0.75rem",
								}}
							>
								{formatTimestamp(message.createdAt)}
							</Typography>
							{isOwnMessage && statusLabel && (
								<Box sx={{ display: "flex", alignItems: "center", gap: 0.35 }}>
									{statusIcon}
									<Typography variant="caption" sx={{ fontSize: "0.7rem", color: statusColor }}>
										{statusLabel}
									</Typography>
								</Box>
							)}
						</Box>
					</>
				)}
			</Box>
		);
	};

	return (
		<Box
			sx={{
				display: "flex",
				height: "100%",
				maxHeight: "100%",
				overflow: "hidden",
				bgcolor: "background.default",
			}}
		>
			{/* Conversation List */}
			<Box
				sx={{
					width: { xs: "100%", md: CONVERSATION_PANEL_WIDTH },
					display: { xs: selectedConversationId ? "none" : "flex", md: "flex" },
					flexDirection: "column",
					borderRight: `1px solid ${theme.palette.divider}`,
					height: "100%",
				}}
			>
				{/* Conversation List Header */}
				<Box sx={{ p: 2, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<Typography variant="h5" fontWeight={800}>
						Messages
					</Typography>
				</Box>

				{/* Conversation List */}
				<Box sx={{ flex: 1, overflowY: "auto" }}>
					{conversationsQuery.isLoading ? (
						<Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
							<CircularProgress size={32} />
						</Box>
					) : conversations.length === 0 ? (
						<Box sx={{ p: 4, textAlign: "center" }}>
							<Typography variant="h6" fontWeight={700} gutterBottom>
								Welcome to your inbox!
							</Typography>
							<Typography variant="body2" color="text.secondary">
								Drop a line, share posts and more with private conversations between you and others.
							</Typography>
						</Box>
					) : (
						<List disablePadding>
							{conversations.map((conversation) => {
								const title = getConversationTitle(conversation, user?.publicId);
								const avatarUrl = getConversationAvatar(conversation, user?.publicId);
								const otherParticipant = getOtherParticipant(conversation, user?.publicId);
								const lastMessagePreview = conversation.lastMessage?.body ?? "No messages yet";
								const isSelected = conversation.publicId === selectedConversationId;

								return (
									<ListItemButton
										key={conversation.publicId}
										selected={isSelected}
										onClick={() => handleSelectConversation(conversation.publicId)}
										sx={{
											alignItems: "flex-start",
											py: 2,
											px: 2,
											borderRight: isSelected ? `2px solid ${theme.palette.primary.main}` : "2px solid transparent",
											bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.05) : "transparent",
											"&:hover": {
												bgcolor: alpha(theme.palette.text.primary, 0.03),
											},
										}}
									>
										<ListItemAvatar sx={{ minWidth: 56 }}>
											<Avatar src={avatarUrl} alt={title} sx={{ width: 40, height: 40 }}>
												{otherParticipant?.username?.charAt(0).toUpperCase()}
											</Avatar>
										</ListItemAvatar>
										<ListItemText
											primary={
												<Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
													<Box sx={{ display: "flex", alignItems: "center", gap: 0.5, overflow: "hidden" }}>
														<Typography variant="subtitle1" fontWeight={700} noWrap>
															{title}
														</Typography>
														{otherParticipant?.handle && (
															<Typography variant="body2" color="text.secondary" noWrap>
																@{otherParticipant.handle}
															</Typography>
														)}
													</Box>
													<Typography variant="caption" color="text.secondary" sx={{ ml: 1, whiteSpace: "nowrap" }}>
														{conversation.lastMessageAt ? formatTimestamp(conversation.lastMessageAt) : ""}
													</Typography>
												</Box>
											}
											secondary={
												<Typography
													variant="body2"
													color={conversation.unreadCount > 0 ? "text.primary" : "text.secondary"}
													fontWeight={conversation.unreadCount > 0 ? 700 : 400}
													noWrap
													sx={{ mt: 0.5 }}
												>
													{lastMessagePreview}
												</Typography>
											}
										/>
									</ListItemButton>
								);
							})}
						</List>
					)}
				</Box>
			</Box>

			{/* Chat Window  */}
			<Box
				sx={{
					flex: 1,
					display: { xs: selectedConversationId ? "flex" : "none", md: "flex" },
					flexDirection: "column",
					height: "100%",
					bgcolor: "background.default",
					position: "relative",
				}}
			>
				{!selectedConversationId ? (
					<Box
						sx={{
							flex: 1,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							flexDirection: "column",
							p: 4,
						}}
					>
						<Typography variant="h4" fontWeight={800} gutterBottom>
							Select a message
						</Typography>
						<Typography variant="body1" color="text.secondary">
							Choose from your existing conversations, start a new one, or just keep swimming.
						</Typography>
						<Button variant="contained" size="large" sx={{ mt: 3, borderRadius: 9999, px: 4, py: 1.5 }}>
							New Message
						</Button>
					</Box>
				) : (
					<>
						{/* Chat Header */}
						<Box
							sx={{
								px: 2,
								py: 1,
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								borderBottom: `1px solid ${theme.palette.divider}`,
								bgcolor: alpha(theme.palette.background.default, 0.85),
								backdropFilter: "blur(12px)",
								position: "sticky",
								top: 0,
								zIndex: 10,
							}}
						>
							<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
								{isMobile && (
									<IconButton size="small" onClick={handleBackToList}>
										<ArrowBackIosNewRoundedIcon fontSize="small" />
									</IconButton>
								)}
								{selectedConversation && (
									<Box
										sx={{
											display: "flex",
											alignItems: "center",
											gap: 1.5,
											cursor: "pointer",
											"&:hover": { opacity: 0.8 },
										}}
										onClick={() => {
											const otherUser = getOtherParticipant(selectedConversation, user?.publicId);
											if (otherUser?.handle || otherUser?.publicId) {
												navigate(`/profile/${otherUser?.handle || otherUser?.publicId}`);
											}
										}}
									>
										<Avatar
											src={getConversationAvatar(selectedConversation, user?.publicId)}
											sx={{ width: 32, height: 32 }}
										>
											{getOtherParticipant(selectedConversation, user?.publicId)?.username?.charAt(0).toUpperCase()}
										</Avatar>
										<Typography variant="h6" fontWeight={700} fontSize="1.1rem">
											{getConversationTitle(selectedConversation, user?.publicId)}
										</Typography>
									</Box>
								)}
							</Box>
							<IconButton>
								<InfoOutlinedIcon />
							</IconButton>
						</Box>

						{/* Messages Area */}
						<Box
							ref={messagesContainerRef}
							onScroll={handleScroll}
							sx={{
								flex: 1,
								overflowY: "auto",
								px: 2,
								py: 2,
								display: "flex",
								flexDirection: "column",
							}}
						>
							{messagesQuery.isLoading ? (
								<Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
									<CircularProgress size={32} />
								</Box>
							) : (
								<>
									{messagesQuery.hasNextPage && (
										<Button
											onClick={() => messagesQuery.fetchNextPage()}
											disabled={messagesQuery.isFetchingNextPage}
											sx={{ alignSelf: "center", mb: 2 }}
										>
											Load older messages
										</Button>
									)}
									{messages.map((message) => renderMessageBubble(message))}
								</>
							)}
						</Box>

						{/* New Messages Indicator */}
						{newMessageCount > 0 && (
							<Fab
								size="small"
								color="primary"
								onClick={handleScrollToNewMessages}
								sx={{
									position: "absolute",
									bottom: 100,
									left: "50%",
									transform: "translateX(-50%)",
									zIndex: 10,
									minWidth: "auto",
									px: 2,
									borderRadius: 4,
								}}
							>
								<Badge
									badgeContent={newMessageCount}
									color="error"
									sx={{ "& .MuiBadge-badge": { right: -8, top: -4 } }}
								>
									<KeyboardArrowDownIcon />
								</Badge>
							</Fab>
						)}

						{/* Input Area */}
						<Box
							component="form"
							onSubmit={handleSendMessage}
							sx={{
								p: 1.5,
								borderTop: `1px solid ${theme.palette.divider}`,
								bgcolor: "background.default",
							}}
						>
							{/* Image Preview */}
							{imageFile && (
								<Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1 }}>
									<Box sx={{ position: "relative" }}>
										<Box
											component="img"
											src={URL.createObjectURL(imageFile)}
											sx={{ width: 50, height: 50, borderRadius: 1, objectFit: "cover" }}
										/>
										<IconButton
											size="small"
											onClick={handleRemoveImage}
											sx={{
												position: "absolute",
												top: -5,
												right: -5,
												bgcolor: "background.paper",
												boxShadow: 1,
												width: 18,
												height: 18,
												"&:hover": { bgcolor: "error.light", color: "white" },
											}}
										>
											<CloseIcon sx={{ fontSize: 12 }} />
										</IconButton>
									</Box>
									<Typography variant="caption" noWrap sx={{ maxWidth: 200 }}>
										{imageFile.name}
									</Typography>
								</Box>
							)}

							{/* Edit Mode Indicator */}
							{isEditing && (
								<Box sx={{ display: "flex", alignItems: "center", mb: 1, gap: 1, px: 1 }}>
									<EditIcon color="primary" fontSize="small" />
									<Typography variant="body2" color="primary" sx={{ flex: 1 }}>
										Editing message
									</Typography>
									<IconButton size="small" onClick={handleCancelEdit}>
										<CancelIcon fontSize="small" />
									</IconButton>
								</Box>
							)}

							<Paper
								elevation={0}
								sx={{
									display: "flex",
									alignItems: "center",
									px: 1,
									py: 0.5,
									borderRadius: 4,
									bgcolor: alpha(theme.palette.text.primary, 0.05),
								}}
							>
								<Input
									type="file"
									inputRef={fileInputRef}
									onChange={handleImageSelect}
									sx={{ display: "none" }}
									inputProps={{ accept: "image/*" }}
								/>
								<IconButton
									size="small"
									color="primary"
									onClick={() => fileInputRef.current?.click()}
									disabled={isEditing}
								>
									<ImageIcon />
								</IconButton>
								<IconButton size="small" color="primary">
									<GifIcon />
								</IconButton>
								<IconButton size="small" color="primary">
									<EmojiEmotionsIcon />
								</IconButton>

								<TextField
									fullWidth
									variant="standard"
									placeholder="Write a message"
									value={draftBody}
									onChange={(event) => setDraftBody(event.target.value)}
									InputProps={{
										disableUnderline: true,
										sx: {
											fontSize: { xs: "0.85rem", sm: "1rem" },
										},
									}}
									sx={{ px: 2 }}
								/>

								<IconButton
									type="submit"
									color="primary"
									disabled={(!draftBody.trim() && !imageFile) || sendMessage.isPending || editMessage.isPending}
									sx={{
										opacity: draftBody.trim() || imageFile ? 1 : 0.5,
									}}
								>
									<SendRoundedIcon />
								</IconButton>
							</Paper>
						</Box>
					</>
				)}
			</Box>

			{/* Message Options Menu */}
			<Menu
				anchorEl={anchorEl}
				open={Boolean(anchorEl)}
				onClose={handleMenuClose}
				anchorOrigin={{
					vertical: "center",
					horizontal: "center",
				}}
				transformOrigin={{
					vertical: "center",
					horizontal: "center",
				}}
			>
				<MenuItem onClick={handleEditStart}>
					<EditIcon fontSize="small" sx={{ mr: 1 }} />
					Edit
				</MenuItem>
				<MenuItem onClick={handleDeleteStart} sx={{ color: "error.main" }}>
					<DeleteIcon fontSize="small" sx={{ mr: 1 }} />
					Delete
				</MenuItem>
			</Menu>

			{/* Delete Confirmation Dialog */}
			<Dialog open={deleteConfirmationOpen} onClose={() => setDeleteConfirmationOpen(false)}>
				<DialogTitle>Delete Message?</DialogTitle>
				<DialogContent>
					<DialogContentText>
						Are you sure you want to delete this message? This action cannot be undone.
					</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setDeleteConfirmationOpen(false)}>Cancel</Button>
					<Button onClick={handleDeleteConfirm} color="error" autoFocus>
						Delete
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
};

export default Messages;
