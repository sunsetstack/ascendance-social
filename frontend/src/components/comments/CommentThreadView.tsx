import React, { useState } from "react";
import {
  Box,
  Typography,
  Avatar,
  IconButton,
  TextField,
  Button,
  CircularProgress,
  Divider,
  Menu,
  MenuItem,
  Stack,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import CancelIcon from "@mui/icons-material/Cancel";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { useNavigate, useParams, Link as RouterLink } from "react-router-dom";
import { IComment } from "../../types";
import { useAuth } from "../../hooks/context/useAuth";
import {
  useCommentThread,
  useCommentDirectReplies,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useLikeComment,
} from "../../hooks/comments/useComments";
import RichText from "../RichText";
import { devError } from "@/lib/devLogger";

interface ThreadCommentItemProps {
  comment: IComment;
  isAncestor?: boolean;
  isFocused?: boolean;
  isMobile?: boolean;
}

const ThreadCommentItem: React.FC<ThreadCommentItemProps> = ({
  comment,
  isAncestor = false,
  isFocused = false,
  isMobile = false,
}) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);

  const updateCommentMutation = useUpdateComment();
  const deleteCommentMutation = useDeleteComment();
  const likeCommentMutation = useLikeComment();

  const isOwner = user?.publicId === comment.user?.publicId;
  const isMenuOpen = Boolean(anchorEl);

  const handleMenuClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await likeCommentMutation.mutateAsync({
        commentId: comment.id,
        postPublicId: comment.postPublicId,
      });
    } catch (error) {
      devError("Failed to like comment:", error);
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditContent(comment.content);
    handleMenuClose();
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent(comment.content);
  };

  const handleSaveEdit = async () => {
    if (editContent.trim() === "") return;
    try {
      await updateCommentMutation.mutateAsync({
        commentId: comment.id,
        commentData: { content: editContent.trim() },
      });
      setIsEditing(false);
    } catch (error) {
      devError("Failed to update comment:", error);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this comment?")) {
      try {
        await deleteCommentMutation.mutateAsync({
          commentId: comment.id,
          postPublicId: comment.postPublicId,
          parentId: comment.parentId,
        });
        navigate(-1);
      } catch (error) {
        devError("Failed to delete comment:", error);
      }
    }
    handleMenuClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    }
  };

  const formatDate = (dateString: Date) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60),
    );

    if (diffInHours < 1) {
      const diffInMinutes = Math.floor(
        (now.getTime() - date.getTime()) / (1000 * 60),
      );
      return diffInMinutes < 1 ? "Just now" : `${diffInMinutes}m`;
    } else if (diffInHours < 24) {
      return `${diffInHours}h`;
    } else {
      const diffInDays = Math.floor(diffInHours / 24);
      return diffInDays === 1 ? "1d" : `${diffInDays}d`;
    }
  };

  const handleCommentClick = () => {
    if (!isFocused && !isAncestor) {
      navigate(`/comments/${comment.id}`);
    }
  };

  const handleAncestorClick = () => {
    if (isAncestor) {
      navigate(`/comments/${comment.id}`);
    }
  };

  // render deleted comment placeholder
  if (comment.isDeleted) {
    return (
      <Box
        sx={{
          display: "flex",
          gap: isMobile ? 1 : 1.5,
          py: isFocused ? (isMobile ? 1.5 : 2) : isMobile ? 1 : 1.5,
          px: isMobile ? 1.5 : 2,
          cursor:
            isAncestor || (!isFocused && (comment.replyCount ?? 0) > 0)
              ? "pointer"
              : "default",
          bgcolor: isFocused ? "action.selected" : "transparent",
          opacity: 0.6,
          "&:hover": {
            bgcolor:
              isAncestor || !isFocused
                ? "action.hover"
                : isFocused
                  ? "action.selected"
                  : "transparent",
          },
          position: "relative",
        }}
        onClick={isAncestor ? handleAncestorClick : handleCommentClick}
      >
        {/* Avatar column with thread line */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <Avatar
            sx={{
              width: isFocused ? (isMobile ? 40 : 48) : isMobile ? 32 : 40,
              height: isFocused ? (isMobile ? 40 : 48) : isMobile ? 32 : 40,
              bgcolor: "action.disabledBackground",
            }}
          >
            ?
          </Avatar>
          {isAncestor && (
            <Box
              sx={{
                width: 2,
                flexGrow: 1,
                bgcolor: "divider",
                mt: 0.5,
              }}
            />
          )}
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              mb: 0.5,
              flexWrap: "wrap",
            }}
          >
            <Typography
              variant={isFocused ? "subtitle1" : "subtitle2"}
              component="span"
              sx={{
                fontWeight: 600,
                color: "text.disabled",
                fontSize: isMobile
                  ? isFocused
                    ? "0.95rem"
                    : "0.875rem"
                  : undefined,
              }}
            >
              [deleted]
            </Typography>
            <Typography
              variant="caption"
              color="text.disabled"
              sx={{ fontSize: isMobile ? "0.7rem" : undefined }}
            >
              · {formatDate(comment.createdAt)}
            </Typography>
          </Box>

          <Typography
            variant={isFocused ? "body1" : "body2"}
            sx={{
              wordBreak: "break-word",
              fontSize: isMobile
                ? isFocused
                  ? "0.9rem"
                  : "0.8125rem"
                : undefined,
              color: "text.disabled",
              fontStyle: "italic",
            }}
          >
            {comment.content}
          </Typography>

          {/* Show reply count for deleted comments */}
          {(comment.replyCount ?? 0) > 0 && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                mt: isMobile ? 0.5 : 1,
              }}
            >
              <ChatBubbleOutlineIcon
                fontSize="small"
                sx={{ color: "text.disabled", fontSize: isMobile ? 16 : 18 }}
              />
              <Typography
                variant="caption"
                sx={{
                  color: "primary.main",
                  fontWeight: 600,
                  cursor: "pointer",
                  "&:hover": { textDecoration: "underline" },
                  fontSize: isMobile ? "0.7rem" : undefined,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/comments/${comment.id}`);
                }}
              >
                {comment.replyCount}{" "}
                {comment.replyCount === 1 ? "reply" : "replies"}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        gap: isMobile ? 1 : 1.5,
        py: isFocused ? (isMobile ? 1.5 : 2) : isMobile ? 1 : 1.5,
        px: isMobile ? 1.5 : 2,
        cursor:
          isAncestor || (!isFocused && (comment.replyCount ?? 0) > 0)
            ? "pointer"
            : "default",
        bgcolor: isFocused ? "action.selected" : "transparent",
        "&:hover": {
          bgcolor:
            isAncestor || !isFocused
              ? "action.hover"
              : isFocused
                ? "action.selected"
                : "transparent",
        },
        position: "relative",
      }}
      onClick={isAncestor ? handleAncestorClick : handleCommentClick}
    >
      {/* Avatar column with thread line */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <Avatar
          src={comment.user?.avatar}
          alt={comment.user?.username || "User"}
          sx={{
            width: isFocused ? (isMobile ? 40 : 48) : isMobile ? 32 : 40,
            height: isFocused ? (isMobile ? 40 : 48) : isMobile ? 32 : 40,
            cursor: comment.user ? "pointer" : "default",
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (comment.user?.handle || comment.user?.publicId) {
              navigate(
                `/profile/${comment.user?.handle || comment.user?.publicId}`,
              );
            }
          }}
        >
          {comment.user?.avatar ? (
            <img
              src={
                comment.user?.avatar?.startsWith("http")
                  ? comment.user?.avatar
                  : `/api/${comment.user?.avatar}`
              }
              alt={comment.user?.username || "User"}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span>
              {comment.user?.username?.charAt(0).toUpperCase() || "?"}
            </span>
          )}
        </Avatar>
        {/* Thread connector line for ancestors */}
        {isAncestor && (
          <Box
            sx={{
              width: 2,
              flexGrow: 1,
              bgcolor: "divider",
              mt: 0.5,
            }}
          />
        )}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            mb: 0.5,
            flexWrap: "wrap",
          }}
        >
          <Typography
            variant={isFocused ? "subtitle1" : "subtitle2"}
            component="span"
            sx={{
              fontWeight: 600,
              cursor: comment.user ? "pointer" : "default",
              "&:hover": comment.user ? { textDecoration: "underline" } : {},
              fontSize: isMobile
                ? isFocused
                  ? "0.95rem"
                  : "0.875rem"
                : undefined,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: isMobile ? "120px" : "200px",
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (comment.user?.handle || comment.user?.publicId) {
                navigate(
                  `/profile/${comment.user?.handle || comment.user?.publicId}`,
                );
              }
            }}
          >
            {comment.user?.username || "[unknown]"}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: isMobile ? "0.7rem" : undefined }}
          >
            · {formatDate(comment.createdAt)}
            {comment.isEdited && " (edited)"}
          </Typography>
          {isOwner && !comment.isDeleted && (
            <IconButton
              size="small"
              onClick={handleMenuClick}
              sx={{ ml: "auto", p: 0.5 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          )}
        </Box>

        {isEditing ? (
          <Stack spacing={1}>
            <TextField
              fullWidth
              multiline
              maxRows={4}
              value={editContent}
              onKeyDown={handleKeyDown}
              onChange={(e) => setEditContent(e.target.value)}
              variant="outlined"
              size="small"
              placeholder="Write a comment..."
              inputProps={{ maxLength: 500 }}
              onClick={(e) => e.stopPropagation()}
            />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveEdit();
                }}
                disabled={
                  updateCommentMutation.isPending || editContent.trim() === ""
                }
              >
                Save
              </Button>
              <Button
                size="small"
                variant="outlined"
                startIcon={<CancelIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelEdit();
                }}
                disabled={updateCommentMutation.isPending}
              >
                Cancel
              </Button>
            </Box>
          </Stack>
        ) : (
          <Typography
            variant={isFocused ? "body1" : "body2"}
            sx={{
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
              fontSize: isMobile
                ? isFocused
                  ? "0.9rem"
                  : "0.85rem"
                : undefined,
            }}
          >
            <RichText text={comment.content} />
          </Typography>
        )}

        {/* Actions */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 2 : 3,
            mt: 1,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              color: "text.secondary",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <IconButton size="small" onClick={handleLike} sx={{ p: 0.5 }}>
              {comment.isLikedByViewer ? (
                <FavoriteIcon fontSize="small" color="primary" />
              ) : (
                <FavoriteBorderIcon fontSize="small" />
              )}
            </IconButton>
            {(comment.likesCount || 0) > 0 && (
              <Typography variant="caption" color="text.secondary">
                {comment.likesCount}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              color: "text.secondary",
            }}
          >
            <ChatBubbleOutlineIcon fontSize="small" />
            {(comment.replyCount || 0) > 0 && (
              <Typography variant="caption" color="text.secondary">
                {comment.replyCount}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      <Menu
        anchorEl={anchorEl}
        open={isMenuOpen}
        onClose={handleMenuClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem onClick={handleEdit}>
          <EditIcon fontSize="small" sx={{ mr: 1 }} />
          Edit
        </MenuItem>
        <MenuItem onClick={handleDelete} sx={{ color: "error.main" }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>
    </Box>
  );
};

const CommentThreadView: React.FC = () => {
  const { commentId } = useParams<{ commentId: string }>();
  const navigate = useNavigate();
  const { user, isLoggedIn } = useAuth();
  const [replyContent, setReplyContent] = useState("");
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const {
    data: threadData,
    isLoading: isLoadingThread,
    isError,
  } = useCommentThread(commentId || "");
  const {
    data: repliesData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingReplies,
  } = useCommentDirectReplies(commentId || "", 10);

  const createCommentMutation = useCreateComment();

  const handleBack = () => {
    navigate(-1);
  };

  const handleReplySubmit = async () => {
    if (!replyContent.trim() || !threadData?.comment) return;

    try {
      await createCommentMutation.mutateAsync({
        imagePublicId: threadData.comment.postPublicId,
        commentData: {
          content: replyContent,
          parentId: commentId,
        },
      });
      setReplyContent("");
    } catch (error) {
      devError("Failed to post reply:", error);
    }
  };

  const allReplies = repliesData?.pages.flatMap((page) => page.comments) ?? [];

  if (isLoadingThread) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "50vh",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (isError || !threadData?.comment) {
    return (
      <Box sx={{ p: 3, textAlign: "center" }}>
        <Typography color="error">Comment not found</Typography>
        <Button onClick={handleBack} sx={{ mt: 2 }}>
          Go Back
        </Button>
      </Box>
    );
  }

  const { comment, ancestors } = threadData;

  return (
    <Box
      sx={{
        width: "100%",
        maxWidth: { xs: "100%", sm: 600 },
        mx: "auto",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 1.5 : 2,
          p: isMobile ? 1.5 : 2,
          borderBottom: 1,
          borderColor: "divider",
          position: "sticky",
          top: 0,
          bgcolor: "background.paper",
          zIndex: 10,
        }}
      >
        <IconButton onClick={handleBack} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant={isMobile ? "subtitle1" : "h6"} fontWeight={700}>
          Thread
        </Typography>
      </Box>

      {/* Link to original post */}
      <Box
        sx={{
          px: isMobile ? 1.5 : 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography
          variant="caption"
          component={RouterLink}
          to={`/posts/${comment.postPublicId}`}
          sx={{
            color: "primary.main",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: isMobile ? "0.75rem" : undefined,
            "&:hover": { textDecoration: "underline" },
          }}
        >
          View original post →
        </Typography>
      </Box>

      {/* Ancestor comments (thread path) */}
      {ancestors.length > 0 && (
        <Box>
          {ancestors.map((ancestor) => (
            <ThreadCommentItem
              key={ancestor.id}
              comment={ancestor}
              isAncestor
              isMobile={isMobile}
            />
          ))}
        </Box>
      )}

      {/* Focused comment */}
      <ThreadCommentItem comment={comment} isFocused isMobile={isMobile} />

      <Divider />

      {/* Reply form */}
      {isLoggedIn && (
        <Box
          sx={{
            p: isMobile ? 1.5 : 2,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", gap: isMobile ? 1 : 1.5 }}>
            <Avatar
              src={user?.avatar}
              sx={{
                width: isMobile ? 32 : 40,
                height: isMobile ? 32 : 40,
                flexShrink: 0,
              }}
            >
              {user?.username?.[0]?.toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <TextField
                fullWidth
                multiline
                maxRows={4}
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder={`Reply to @${comment.user?.username || "comment"}...`}
                variant="outlined"
                size="small"
                inputProps={{ maxLength: 280 }}
                sx={{
                  "& .MuiInputBase-input": {
                    fontSize: isMobile ? "0.875rem" : undefined,
                  },
                }}
              />
              <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleReplySubmit}
                  disabled={
                    !replyContent.trim() || createCommentMutation.isPending
                  }
                >
                  {createCommentMutation.isPending ? "Posting..." : "Reply"}
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* Replies */}
      <Box sx={{ flex: 1 }}>
        {isLoadingReplies ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : allReplies.length > 0 ? (
          <>
            {allReplies.map((reply) => (
              <Box
                key={reply.id}
                sx={{ borderBottom: 1, borderColor: "divider" }}
              >
                <ThreadCommentItem comment={reply} isMobile={isMobile} />
              </Box>
            ))}
            {hasNextPage && (
              <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                <Button
                  variant="text"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                >
                  {isFetchingNextPage ? "Loading..." : "Show more replies"}
                </Button>
              </Box>
            )}
          </>
        ) : (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              No replies yet
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default CommentThreadView;
