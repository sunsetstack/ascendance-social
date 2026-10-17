import React, { useState } from "react";
import { Box, Button, Avatar, Stack } from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import { useAuth } from "../../hooks/context/useAuth";
import { useCreateComment } from "../../hooks/comments/useComments";
import MentionInput from "../MentionInput";
import { devError } from "@/lib/devLogger";
import { buildAvatarUrl } from "@/lib/media";
import ImageAttachmentInput from "../ImageAttachmentInput";
import { Alert } from "@mui/material";

interface CommentFormProps {
  postId: string;
}

const CommentForm: React.FC<CommentFormProps> = ({ postId }) => {
  const { user, isLoggedIn } = useAuth();
  const [content, setContent] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const createCommentMutation = useCreateComment();

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();

    if ((!content.trim() && !image) || !isLoggedIn) return;

    try {
      await createCommentMutation.mutateAsync({
        imagePublicId: postId,
        commentData: { content: content.trim(), image: image ?? undefined },
      });
      setContent("");
      setImage(null);
    } catch (error) {
      devError("Failed to create comment:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "Enter") {
      void handleSubmit(e);
    }
  };

  if (!isLoggedIn) {
    return null;
  }

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ mt: 2 }}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <Avatar
          src={buildAvatarUrl(user?.avatar, 32)}
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

          <ImageAttachmentInput file={image} onChange={setImage} disabled={createCommentMutation.isPending} />
          {createCommentMutation.isError && <Alert severity="error">Unable to post your comment. Please try again.</Alert>}
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
            <Button
              type="submit"
              variant="contained"
              size="small"
              endIcon={<SendIcon />}
              disabled={createCommentMutation.isPending || (!content.trim() && !image)}
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
