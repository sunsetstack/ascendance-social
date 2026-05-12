import React, { useState } from "react";
import { Box, Button, Avatar, Stack } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useAuth } from "../../hooks/context/useAuth";
import { useCreateComment } from "../../hooks/comments/useComments";
import MentionInput from "../MentionInput";
import { devError } from "@/lib/devLogger";

interface CommentFormProps {
  postId: string;
}

const CommentForm: React.FC<CommentFormProps> = ({ postId }) => {
  const { user, isLoggedIn } = useAuth();
  const [content, setContent] = useState("");
  const createCommentMutation = useCreateComment();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim() || !isLoggedIn) return;

    try {
      await createCommentMutation.mutateAsync({
        imagePublicId: postId,
        commentData: { content: content.trim() },
      });
      setContent("");
    } catch (error) {
      devError("Failed to create comment:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      e.preventDefault();
      const formEvent = new Event("submit", {
        bubbles: true,
        cancelable: true,
      });
      handleSubmit(formEvent as unknown as React.FormEvent);
    }
  };

  if (!isLoggedIn) {
    return null;
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Avatar
          src={user?.avatar}
          alt={user?.username}
          sx={{ width: 32, height: 32, mt: 0.5 }}
        >
          {user?.username?.[0]?.toUpperCase()}
        </Avatar>

        <Box sx={{ flex: 1 }}>
          <MentionInput
            value={content}
            onChange={setContent}
            onKeyDown={handleKeyDown}
            placeholder="Write a comment..."
            multiline
            maxRows={4}
            disabled={createCommentMutation.isPending}
            sx={{ width: "100%" }}
          />

          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
            <Button
              type="submit"
              variant="contained"
              size="small"
              endIcon={<SendIcon />}
              disabled={createCommentMutation.isPending || !content.trim()}
            >
              {createCommentMutation.isPending ? "Posting..." : "Post"}
            </Button>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
};

export default CommentForm;
