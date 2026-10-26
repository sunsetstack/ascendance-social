import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Fab,
  IconButton,
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
  Badge,
  Alert,
} from "@mui/material";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import ArrowBackIosNewRoundedIcon from "@mui/icons-material/ArrowBackIosNewRounded";
import {
  CheckCircle as CheckCircleIcon,
  Done as DoneIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Cancel as CancelIcon,
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
import {
  getConversationTitle,
  getOtherParticipant,
  formatTimestamp,
  MessagesConversationList,
} from "../components/messages/MessagesConversationList";
import { MessageDTO } from "../types";
import { isAxiosError } from "axios";

const CONVERSATION_PANEL_WIDTH = 380;
const CONVERSATION_PRESENCE_HEARTBEAT_MS = 30_000;

const getActionErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

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
  const unavailableConversationIds = useRef<Set<string>>(new Set());

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedMessage, setSelectedMessage] = useState<MessageDTO | null>(
    null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
    if (!socket || !selectedConversationId) return;

    const emitPresence = () => {
      socket.emit("conversation_opened", selectedConversationId);
    };

    emitPresence();
    const heartbeatId = window.setInterval(
      emitPresence,
      CONVERSATION_PRESENCE_HEARTBEAT_MS,
    );

    return () => {
      window.clearInterval(heartbeatId);
      socket.emit("conversation_closed", selectedConversationId);
    };
  }, [selectedConversationId, socket]);

  const firstConversationId = conversations.find(
    (conversation) =>
      !unavailableConversationIds.current.has(conversation.publicId),
  )?.publicId;

  useEffect(() => {
    if (!selectedConversationId && firstConversationId && !isMobile) {
      navigate(`?conversation=${firstConversationId}`, { replace: true });
    }
  }, [firstConversationId, selectedConversationId, navigate, isMobile]);

  const markConversationRead = useMarkConversationRead();
  const selectedConversation = useMemo(() => {
    return conversations.find((c) => c.publicId === selectedConversationId);
  }, [conversations, selectedConversationId]);
  const selectedOtherParticipant = selectedConversation
    ? getOtherParticipant(selectedConversation, user?.publicId)
    : null;
  const canOpenSelectedParticipant =
    !!selectedOtherParticipant &&
    !selectedOtherParticipant.isUnavailable &&
    !!(selectedOtherParticipant.handle || selectedOtherParticipant.publicId);

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

  useEffect(() => {
    if (
      isAxiosError(messagesQuery.error) &&
      [403, 404].includes(messagesQuery.error.response?.status ?? 0)
    ) {
      if (selectedConversationId) {
        unavailableConversationIds.current.add(selectedConversationId);
      }
      navigate("/messages", { replace: true });
    }
  }, [messagesQuery.error, selectedConversationId, navigate]);

  useEffect(() => {
    if (selectedConversation?.isLocked) {
      setIsEditing(false);
      setAnchorEl(null);
      setSelectedMessage(null);
      setDeleteConfirmationOpen(false);
    }
  }, [selectedConversation?.isLocked]);

  const messages = useMemo(() => {
    const pages = messagesQuery.data?.pages ?? [];
    const flattened = pages.flatMap((page) => page.messages);
    const sorted = [...flattened].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    return sorted;
  }, [messagesQuery.data?.pages]);

  // get the last message id to track new messages
  const lastMessageId =
    messages.length > 0 ? messages[messages.length - 1]?.publicId : null;

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
    const { scrollTop, scrollHeight, clientHeight } =
      messagesContainerRef.current;
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
    unavailableConversationIds.current.delete(conversationId);
    setActionError(null);
    navigate(`?conversation=${conversationId}`);
  };

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !draftBody.trim() ||
      !selectedConversationId ||
      selectedConversation?.isClosed ||
      selectedConversation?.isLocked ||
      sendMessage.isPending ||
      editMessage.isPending
    )
      return;

    setActionError(null);

    try {
      if (isEditing && selectedMessage) {
        await editMessage.mutateAsync({
          messageId: selectedMessage.publicId,
          body: draftBody.trim(),
        });
        setIsEditing(false);
        setSelectedMessage(null);
      } else {
        const payload = new FormData();
        payload.append("conversationPublicId", selectedConversationId);
        payload.append("body", draftBody.trim());
        await sendMessage.mutateAsync(payload);
      }

      setDraftBody("");
    } catch (error) {
      setActionError(
        getActionErrorMessage(
          error,
          isEditing
            ? "Unable to update the message."
            : "Unable to send the message.",
        ),
      );
    }
  };

  const handleBackToList = () => {
    setActionError(null);
    navigate("/messages");
  };

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLDivElement>,
    message: MessageDTO,
  ) => {
    event.preventDefault();
    if (selectedConversation?.isLocked) return;
    if (message.sender.publicId !== user?.publicId) return;
    setAnchorEl(event.currentTarget);
    setSelectedMessage(message);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedMessage(null);
  };

  const handleEditStart = () => {
    setActionError(null);
    if (selectedMessage) {
      setDraftBody(selectedMessage.body);
      setIsEditing(true);
    }
    setAnchorEl(null);
  };

  const handleDeleteStart = () => {
    setActionError(null);
    setDeleteConfirmationOpen(true);
    setAnchorEl(null);
  };

  const handleDeleteConfirm = async () => {
    if (
      !selectedMessage ||
      !selectedConversationId ||
      selectedConversation?.isLocked
    ) return;

    setActionError(null);

    try {
      await deleteMessage.mutateAsync({
        messageId: selectedMessage.publicId,
        conversationId: selectedConversationId,
      });
      setDeleteConfirmationOpen(false);
      setSelectedMessage(null);
    } catch (error) {
      setActionError(
        getActionErrorMessage(error, "Unable to delete the message."),
      );
    }
  };

  const handleDeleteDialogClose = () => {
    if (deleteMessage.isPending) return;

    setDeleteConfirmationOpen(false);
    setSelectedMessage(null);
    setActionError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setDraftBody("");
    setSelectedMessage(null);
    setActionError(null);
  };

  const renderMessageBubble = (message: MessageDTO) => {
    const isOwnMessage = message.sender.publicId === user?.publicId;
    const statusLabel =
      message.status === "read"
        ? "Read"
        : message.status === "delivered"
          ? "Delivered"
          : "Sent";
    const statusColor =
      message.status === "read" ? "primary.main" : "text.secondary";
    const statusIcon =
      message.status === "read" ? (
        <CheckCircleIcon sx={{ fontSize: 12, color: statusColor }} />
      ) : (
        <DoneIcon sx={{ fontSize: 12, color: statusColor }} />
      );

    const hasText = message.body && message.body.trim().length > 0;
    const isDeletedMessage = message.body === "message deleted by user";
    const displayBody = hasText ? message.body : "Attachment unavailable";

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
        <>
          <Box
            onContextMenu={(e) => handleMenuOpen(e, message)}
            sx={{
              maxWidth: "70%",
              px: 2,
              py: 1.5,
              borderRadius: isOwnMessage
                ? "22px 22px 4px 22px"
                : "22px 22px 22px 4px",
              bgcolor: isOwnMessage
                ? "primary.main"
                : alpha(theme.palette.text.primary, 0.05),
              color: isOwnMessage ? "#fff" : "text.primary",
              position: "relative",
              wordBreak: "break-word",
              boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
              cursor: isOwnMessage ? "pointer" : "default",
            }}
          >
            <Typography
              variant="body1"
              sx={{
                fontSize: "0.95rem",
                lineHeight: 1.5,
                fontStyle: isDeletedMessage || !hasText ? "italic" : "normal",
                color:
                  isDeletedMessage || !hasText
                    ? isOwnMessage
                      ? "rgba(255,255,255,0.7)"
                      : "text.secondary"
                    : "inherit",
              }}
            >
              {displayBody}
            </Typography>
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mt: 0.5,
              px: 1,
            }}
          >
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
                <Typography
                  variant="caption"
                  sx={{ fontSize: "0.7rem", color: statusColor }}
                >
                  {statusLabel}
                </Typography>
              </Box>
            )}
          </Box>
        </>
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
        <Box
          sx={{
            p: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography variant="h5" fontWeight={800}>
            Messages
          </Typography>
        </Box>

        <MessagesConversationList
          conversations={conversations}
          currentUserId={user?.publicId}
          selectedConversationId={selectedConversationId}
          isLoading={conversationsQuery.isLoading}
          isError={conversationsQuery.isError}
          hasNextPage={!!conversationsQuery.hasNextPage}
          isFetchingNextPage={conversationsQuery.isFetchingNextPage}
          onRetry={() => void conversationsQuery.refetch()}
          onLoadMore={() => void conversationsQuery.fetchNextPage()}
          onSelect={handleSelectConversation}
          isAdmin={Boolean(user?.isAdmin)}
          onRemoved={(id) => {
            if (id === selectedConversationId) {
              setDraftBody("");
              setIsEditing(false);
              setSelectedMessage(null);
              navigate("/messages", { replace: true });
            }
          }}
        />
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
              Choose from your existing conversations.
            </Typography>
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
                  <IconButton
                    size="small"
                    onClick={handleBackToList}
                    aria-label="Back to conversations"
                  >
                    <ArrowBackIosNewRoundedIcon fontSize="small" />
                  </IconButton>
                )}
                {selectedConversation && (
                  <Box
                    component="button"
                    type="button"
                    disabled={!canOpenSelectedParticipant}
                    aria-label={
                      canOpenSelectedParticipant
                        ? `View ${
                            selectedOtherParticipant?.username || "participant"
                          } profile`
                        : undefined
                    }
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1.5,
                      p: 0,
                      border: 0,
                      bgcolor: "transparent",
                      color: "inherit",
                      font: "inherit",
                      textAlign: "left",
                      cursor: canOpenSelectedParticipant
                        ? "pointer"
                        : "default",
                      "&:hover": canOpenSelectedParticipant
                        ? { opacity: 0.8 }
                        : undefined,
                      "&:focus-visible": {
                        borderRadius: 1,
                        outline: `2px solid ${theme.palette.primary.main}`,
                        outlineOffset: 2,
                      },
                    }}
                    onClick={() => {
                      if (
                        !canOpenSelectedParticipant ||
                        !selectedOtherParticipant
                      )
                        return;

                      navigate(
                        `/profile/${
                          selectedOtherParticipant.handle ||
                          selectedOtherParticipant.publicId
                        }`,
                      );
                    }}
                  >
                    <Avatar
                      src={selectedOtherParticipant?.avatar || ""}
                      sx={{ width: 32, height: 32 }}
                    >
                      {selectedOtherParticipant?.username
                        ?.charAt(0)
                        .toUpperCase()}
                    </Avatar>
                    <Typography variant="h6" fontWeight={700} fontSize="1.1rem">
                      {getConversationTitle(
                        selectedConversation,
                        user?.publicId,
                      )}
                    </Typography>
                  </Box>
                )}
              </Box>
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
              {messagesQuery.isError && (
                <Alert
                  severity="error"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      onClick={() => void messagesQuery.refetch()}
                    >
                      Retry
                    </Button>
                  }
                  sx={{ alignSelf: "center", mt: 2 }}
                >
                  Unable to load messages.
                </Alert>
              )}
              {messagesQuery.isLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
                  <CircularProgress size={32} />
                </Box>
              ) : (
                <>
                  {messagesQuery.hasNextPage && (
                    <Button
                      onClick={() => void messagesQuery.fetchNextPage()}
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
                aria-label={`${newMessageCount} new ${
                  newMessageCount === 1 ? "message" : "messages"
                }`}
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
              {selectedConversation?.isClosed && (
                <Alert severity="info" sx={{ mb: 1 }}>
                  This participant is unavailable. The conversation remains
                  readable, but no new replies can be sent.
                </Alert>
              )}
              {selectedConversation?.isLocked && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                  Conversation locked by admin
                </Alert>
              )}
              {actionError && !deleteConfirmationOpen && (
                <Alert
                  severity="error"
                  onClose={() => setActionError(null)}
                  sx={{ mb: 1 }}
                >
                  {actionError}
                </Alert>
              )}
              {/* Edit Mode Indicator */}
              {isEditing && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    mb: 1,
                    gap: 1,
                    px: 1,
                  }}
                >
                  <EditIcon color="primary" fontSize="small" />
                  <Typography variant="body2" color="primary" sx={{ flex: 1 }}>
                    Editing message
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={handleCancelEdit}
                    aria-label="Cancel message editing"
                  >
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
                <TextField
                  fullWidth
                  variant="standard"
                  placeholder="Write a message"
                  value={draftBody}
                  onChange={(event) => setDraftBody(event.target.value)}
                  disabled={
                    sendMessage.isPending ||
                    editMessage.isPending ||
                    selectedConversation?.isLocked ||
                    selectedConversation?.isClosed
                  }
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
                  aria-label={
                    isEditing ? "Save edited message" : "Send message"
                  }
                  disabled={
                    !draftBody.trim() ||
                    sendMessage.isPending ||
                    editMessage.isPending ||
                    selectedConversation?.isLocked ||
                    selectedConversation?.isClosed
                  }
                  sx={{
                    opacity: draftBody.trim() ? 1 : 0.5,
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
      <Dialog
        open={deleteConfirmationOpen}
        onClose={handleDeleteDialogClose}
      >
        <DialogTitle>Delete Message?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this message? This action cannot be
            undone.
          </DialogContentText>
          {actionError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={handleDeleteDialogClose}
            disabled={deleteMessage.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            autoFocus
            disabled={deleteMessage.isPending}
          >
            {deleteMessage.isPending ? "Deleting..." : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Messages;
