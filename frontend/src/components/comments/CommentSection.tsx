import React from "react";
import {
  Box,
  Typography,
  Button,
  Stack,
  CircularProgress,
  Divider,
  Alert,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CommentItem from "./CommentItem";
import CommentForm from "./CommentForm";
import { useCommentsByPostId } from "../../hooks/comments/useComments";
import { useAuth } from "../../hooks/context/useAuth";

interface CommentSectionProps {
  postId: string;
  commentsCount?: number;
}

const CommentSection: React.FC<CommentSectionProps> = ({
  postId,
  commentsCount = 0,
}) => {
  const { isLoggedIn } = useAuth();
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useCommentsByPostId(postId, 10);

  const allComments = data?.pages.flatMap((page) => page.comments) ?? [];
  const totalComments = data?.pages[0]?.total ?? commentsCount;

  if (isError) {
    return (
      <Box sx={{ mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Comments ({totalComments})
        </Typography>
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load comments: {error?.message}
        </Alert>
        {isLoggedIn ? (
          <CommentForm postId={postId} />
        ) : (
          <Typography variant="body2" color="text.secondary">
            Sign in to join the conversation.
          </Typography>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Comments ({totalComments})
      </Typography>

      {isLoggedIn ? (
        <CommentForm postId={postId} />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Sign in to join the conversation.
        </Typography>
      )}

      {totalComments > 0 && (
        <>
          <Divider sx={{ my: 2 }} />

          {isLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
              <CircularProgress size={24} />
            </Box>
          ) : (
            <Stack spacing={2}>
              {allComments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} />
              ))}

              {hasNextPage && (
                <Box sx={{ display: "flex", justifyContent: "center", pt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    endIcon={
                      isFetchingNextPage ? (
                        <CircularProgress size={16} />
                      ) : (
                        <ExpandMoreIcon />
                      )
                    }
                  >
                    {isFetchingNextPage ? "Loading..." : "Load more comments"}
                  </Button>
                </Box>
              )}
            </Stack>
          )}
        </>
      )}

      {!isLoading && totalComments === 0 && (
        <Box sx={{ textAlign: "center", py: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {isLoggedIn
              ? "No comments yet. Be the first to comment!"
              : "No comments yet."}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default CommentSection;
