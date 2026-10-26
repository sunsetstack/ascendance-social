import type { FC } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import type { ConversationSummaryDTO } from "../../types";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { ConversationActions } from "./ConversationActions";

interface MessagesConversationListProps {
  conversations: ConversationSummaryDTO[];
  currentUserId?: string | null;
  selectedConversationId: string | null;
  isLoading: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onSelect: (conversationId: string) => void;
  onRemoved: (conversationId: string) => void;
  isAdmin: boolean;
}

export const formatTimestamp = (timestamp: string): string => {
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

export const getConversationTitle = (
  conversation: ConversationSummaryDTO,
  currentUserId?: string | null,
): string => {
  if (conversation.title) {
    return conversation.title;
  }

  const others = conversation.participants.filter(
    (participant) => participant.publicId !== currentUserId,
  );
  if (others.length === 0 && conversation.participants.length > 0) {
    return conversation.participants[0].username;
  }

  const label = others.map((participant) => participant.username).join(", ");
  return label || "Direct Message";
};

export const getOtherParticipant = (
  conversation: ConversationSummaryDTO,
  currentUserId?: string | null,
): ConversationSummaryDTO["participants"][number] | null => {
  const others = conversation.participants.filter(
    (participant) => participant.publicId !== currentUserId,
  );
  return others[0] || null;
};

const getConversationAvatar = (
  conversation: ConversationSummaryDTO,
  currentUserId?: string | null,
): string => getOtherParticipant(conversation, currentUserId)?.avatar || "";

export const MessagesConversationList: FC<MessagesConversationListProps> = ({
  conversations,
  currentUserId,
  selectedConversationId,
  isLoading,
  isError,
  hasNextPage,
  isFetchingNextPage,
  onRetry,
  onLoadMore,
  onSelect,
  onRemoved,
  isAdmin,
}) => {
  const theme = useTheme();

  return (
    <Box sx={{ flex: 1, overflowY: "auto" }}>
      {isError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
          sx={{ m: 2 }}
        >
          Unable to load conversations.
        </Alert>
      )}

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
          <CircularProgress size={32} />
        </Box>
      ) : conversations.length > 0 ? (
        <List disablePadding>
          {conversations.map((conversation) => {
            const title = getConversationTitle(conversation, currentUserId);
            const avatarUrl = getConversationAvatar(
              conversation,
              currentUserId,
            );
            const otherParticipant = getOtherParticipant(
              conversation,
              currentUserId,
            );
            const lastMessagePreview =
              conversation.lastMessage?.body ?? "No messages yet";
            const isSelected = conversation.publicId === selectedConversationId;

            return (
              <ConversationActions
                key={conversation.publicId}
                conversation={conversation}
                isAdmin={isAdmin}
                onRemoved={onRemoved}
              >
                <ListItemButton
                  selected={isSelected}
                  onClick={() => onSelect(conversation.publicId)}
                  sx={{
                    alignItems: "flex-start",
                    py: 2,
                    px: 2,
                    pr: 5,
                    borderRight: isSelected
                      ? `2px solid ${theme.palette.primary.main}`
                      : "2px solid transparent",
                    bgcolor: isSelected
                      ? alpha(theme.palette.primary.main, 0.05)
                      : "transparent",
                    "&:hover": {
                      bgcolor: alpha(theme.palette.text.primary, 0.03),
                    },
                  }}
                >
                  <ListItemAvatar sx={{ minWidth: 56 }}>
                    <Avatar
                      src={avatarUrl}
                      alt={title}
                      sx={{ width: 40, height: 40 }}
                    >
                      {otherParticipant?.username?.charAt(0).toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                        }}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 0.5,
                            overflow: "hidden",
                          }}
                        >
                          <Typography
                            variant="subtitle1"
                            fontWeight={700}
                            noWrap
                          >
                            {title}
                          </Typography>
                          {otherParticipant?.handle && (
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              noWrap
                            >
                              @{otherParticipant.handle}
                            </Typography>
                          )}
                          {conversation.isLocked && (
                            <LockOutlined
                              fontSize="small"
                              aria-label="Conversation locked by admin"
                            />
                          )}
                        </Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 1, whiteSpace: "nowrap" }}
                        >
                          {conversation.lastMessageAt
                            ? formatTimestamp(conversation.lastMessageAt)
                            : ""}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Typography
                        variant="body2"
                        color={
                          conversation.unreadCount > 0
                            ? "text.primary"
                            : "text.secondary"
                        }
                        fontWeight={conversation.unreadCount > 0 ? 700 : 400}
                        noWrap
                        sx={{ mt: 0.5 }}
                      >
                        {conversation.isLocked
                          ? "Conversation locked by admin"
                          : lastMessagePreview}
                      </Typography>
                    }
                  />
                </ListItemButton>
              </ConversationActions>
            );
          })}

          {hasNextPage && (
            <Box
              component="li"
              sx={{
                display: "flex",
                justifyContent: "center",
                p: 2,
                listStyle: "none",
              }}
            >
              <Button onClick={onLoadMore} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading..." : "Load more conversations"}
              </Button>
            </Box>
          )}
        </List>
      ) : isError ? null : (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Welcome to your inbox!
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Drop a line, share posts and more with private conversations between
            you and others.
          </Typography>
        </Box>
      )}
    </Box>
  );
};
