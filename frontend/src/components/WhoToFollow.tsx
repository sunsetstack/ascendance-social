import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Avatar,
  Button,
  Skeleton,
  useTheme,
  ListItemButton,
  alpha,
} from "@mui/material";
import { Link } from "react-router-dom";
import { useWhoToFollow } from "../hooks/user/useWhoToFollow";
import { useFollowUser } from "../hooks/user/useUserAction";
import { useQueryClient } from "@tanstack/react-query";
import { SuggestedUser } from "@/types";
import { useTranslation } from "react-i18next";
import { devError } from "@/lib/devLogger";

interface WhoToFollowProps {
  limit?: number;
}

const WhoToFollow: React.FC<WhoToFollowProps> = ({ limit = 5 }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useWhoToFollow(limit);
  const followMutation = useFollowUser();

  // track follow state for each user (publicId -> isFollowing)
  const [followStates, setFollowStates] = useState<Record<string, boolean>>({});

  // initialize follow states when data loads
  useEffect(() => {
    if (data?.suggestions) {
      const initialStates: Record<string, boolean> = {};
      data.suggestions.forEach((user) => {
        // users in suggestions are not followed yet
        initialStates[user.publicId] = false;
      });
      setFollowStates(initialStates);
    }
  }, [data?.suggestions]);

  if (isError) {
    return null;
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, fontWeight: 800 }}>
          {t("common.who_to_follow")}
        </Typography>
        {Array.from({ length: 3 }).map((_, index) => (
          <Box
            key={index}
            sx={{ display: "flex", alignItems: "center", mb: 2 }}
          >
            <Skeleton variant="circular" width={40} height={40} />
            <Box sx={{ ml: 2, flex: 1 }}>
              <Skeleton variant="text" width="60%" height={20} />
              <Skeleton variant="text" width="40%" height={16} />
            </Box>
            <Skeleton
              variant="rectangular"
              width={70}
              height={32}
              sx={{ borderRadius: 9999 }}
            />
          </Box>
        ))}
      </Box>
    );
  }

  if (!data?.suggestions || data.suggestions.length === 0) {
    return (
      <Box sx={{ px: 2, py: 2 }}>
        <Typography variant="h6" sx={{ mb: 1, fontWeight: 800 }}>
          {t("common.who_to_follow")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("common.no_suggestions_right_now")}
        </Typography>
      </Box>
    );
  }

  const handleFollow = async (e: React.MouseEvent, publicId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const currentlyFollowing = followStates[publicId] || false;

    try {
      // optimistically toggle the follow state
      setFollowStates((prev) => ({
        ...prev,
        [publicId]: !currentlyFollowing,
      }));

      await followMutation.mutateAsync(publicId);

      // invalidate to ensure data is fresh
      queryClient.invalidateQueries({
        queryKey: ["isFollowing", publicId],
      });
      queryClient.invalidateQueries({
        queryKey: ["whoToFollow", limit],
        refetchType: "active",
      });
    } catch (error) {
      devError("Failed to follow user:", error);
      // revert the optimistic update on err
      setFollowStates((prev) => ({
        ...prev,
        [publicId]: currentlyFollowing,
      }));
    }
  };
  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 1, px: 2, py: 1.5, fontWeight: 800 }}>
        {t("common.who_to_follow")}
      </Typography>

      {data.suggestions.map((user: SuggestedUser) => (
        <ListItemButton
          component={Link}
          to={`/profile/${user.handle}`}
          key={user.publicId}
          sx={{
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            "&:hover": {
              backgroundColor: alpha(theme.palette.text.primary, 0.03),
            },
          }}
        >
          <Avatar
            src={user.avatar}
            alt={user.username}
            sx={{
              width: 40,
              height: 40,
            }}
          />

          <Box sx={{ ml: 1.5, flex: 1, minWidth: 0 }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 700,
                color: "text.primary",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                "&:hover": {
                  textDecoration: "underline",
                },
              }}
            >
              {user.username}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                fontSize: "0.9rem",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              @{user.handle}
            </Typography>
          </Box>

          <Button
            onClick={(e) => handleFollow(e, user.publicId)}
            disabled={followMutation.isPending}
            variant={followStates[user.publicId] ? "outlined" : "contained"}
            size="small"
            sx={{
              textTransform: "none",
              fontWeight: 700,
              borderRadius: 9999,
              px: 2,
              minWidth: 78,
              height: 32,
              bgcolor: followStates[user.publicId]
                ? "transparent"
                : "common.white",
              color: followStates[user.publicId]
                ? "text.primary"
                : "common.black",
              borderColor: followStates[user.publicId]
                ? "divider"
                : "transparent",
              "&:hover": {
                bgcolor: followStates[user.publicId]
                  ? "action.hover"
                  : alpha(theme.palette.common.white, 0.9),
                borderColor: followStates[user.publicId]
                  ? "error.main"
                  : "transparent",
                color: followStates[user.publicId]
                  ? "error.main"
                  : "common.black",
              },
            }}
          >
            {followMutation.isPending
              ? "..."
              : followStates[user.publicId]
                ? "Unfollow"
                : "Follow"}
          </Button>
        </ListItemButton>
      ))}
    </Box>
  );
};

export default WhoToFollow;
