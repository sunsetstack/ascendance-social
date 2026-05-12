import React, { useState } from "react";
import { IPost } from "../types";
import {
  Typography,
  Box,
  Avatar,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CommentIcon from "@mui/icons-material/Comment";
import VisibilityIcon from "@mui/icons-material/Visibility";
import RepeatIcon from "@mui/icons-material/Repeat";
import GroupsIcon from "@mui/icons-material/Groups";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import DeleteIcon from "@mui/icons-material/Delete";
import { useNavigate } from "react-router-dom";
import RichText from "./RichText";
import {
  useRepostPost,
  useDeletePost,
  useUnrepostPost,
} from "../hooks/posts/usePosts";
import { useAuth } from "../hooks/context/useAuth";
import { useTranslation } from "react-i18next";
import {
  buildMediaUrl,
  buildResponsiveCloudinarySrcSet,
  transformCloudinaryUrl,
} from "../lib/media";

interface PostCardProps {
  post: IPost;
  prioritizeImage?: boolean;
}

// Format large numbers 2345 -> 2.3K
const formatCount = (count: number | undefined): string => {
  if (count === undefined || count === null) {
    return "0";
  }
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

const PostCard: React.FC<PostCardProps> = ({
  post,
  prioritizeImage = false,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isLoggedIn, user } = useAuth();
  const { mutate: triggerRepost } = useRepostPost();
  const { mutate: triggerUnrepost } = useUnrepostPost();
  const { mutate: deletePost } = useDeletePost();
  const [isExpanded, setIsExpanded] = useState(false);

  const isAdmin = user?.isAdmin;
  const isOwnRepost =
    post.type === "repost" && post.user?.publicId === user?.publicId;
  const hasReposted = isOwnRepost || post.isRepostedByViewer;

  const handleDeletePost = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      window.confirm(
        t("post.confirm_delete", {
          defaultValue: "Are you sure you want to delete this post?",
        }),
      )
    ) {
      deletePost(post.publicId);
    }
  };

  const handleClick = () => {
    navigate(`/posts/${post.publicId}`);
  };

  const handleRepostClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!isLoggedIn) {
      navigate("/login");
      return;
    }

    // For repost cards, target the original post
    const targetId =
      post.type === "repost" && post.repostOf?.publicId
        ? post.repostOf.publicId
        : post.publicId;

    // Determine if the user has already reposted (own repost card or server flag)
    const isOwnRepost =
      post.type === "repost" && post.user?.publicId === user?.publicId;
    const hasReposted = isOwnRepost || post.isRepostedByViewer;

    if (hasReposted) {
      triggerUnrepost({ postPublicId: targetId });
    } else {
      triggerRepost({ postPublicId: targetId });
    }
  };

  const fullImageUrl =
    buildMediaUrl(post.url) ?? buildMediaUrl(post.image?.url);
  const hasImage = !!fullImageUrl;
  const communityAvatarUrl = transformCloudinaryUrl(
    buildMediaUrl(post.community?.avatar),
    {
      width: 48,
      height: 48,
      crop: "fill",
    },
  );
  const userAvatarUrl = transformCloudinaryUrl(
    buildMediaUrl(post.user?.avatar),
    {
      width: 80,
      height: 80,
      crop: "fill",
    },
  );
  const postImageUrl = transformCloudinaryUrl(fullImageUrl, {
    width: 960,
    crop: "limit",
    quality: "auto:eco",
    dpr: false,
  });
  const postImageSrcSet = buildResponsiveCloudinarySrcSet(
    fullImageUrl,
    [320, 480, 640, 768, 960, 1080],
    {
      crop: "limit",
      quality: "auto:eco",
    },
  );
  const repostImageRawUrl = buildMediaUrl(post.repostOf?.image?.url);
  const repostImageUrl = transformCloudinaryUrl(repostImageRawUrl, {
    width: 640,
    crop: "limit",
    quality: "auto:eco",
    dpr: false,
  });
  const repostImageSrcSet = buildResponsiveCloudinarySrcSet(
    repostImageRawUrl,
    [256, 384, 512, 640],
    {
      crop: "limit",
      quality: "auto:eco",
    },
  );
  const repostAvatarUrl = transformCloudinaryUrl(
    buildMediaUrl(post.repostOf?.user?.avatar),
    {
      width: 48,
      height: 48,
      crop: "fill",
    },
  );
  const shouldPrioritizeImage = prioritizeImage && hasImage;

  return (
    <Box
      sx={{
        width: "100%",
        borderBottom: "1px solid",
        borderColor: "divider",
        cursor: "pointer",
        transition: "background-color 0.2s",
        "&:hover": {
          bgcolor: "rgba(255, 255, 255, 0.03)",
        },
      }}
      onClick={handleClick}
    >
      {/* Community Badge - shown when post is from a community */}
      {post.community && (
        <Box
          sx={{
            px: 2,
            pt: 1.5,
            pb: 0.5,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
          }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/communities/${post.community!.slug}`);
          }}
        >
          {post.community.avatar ? (
            <Avatar src={communityAvatarUrl} sx={{ width: 16, height: 16 }} />
          ) : (
            <GroupsIcon sx={{ fontSize: 16, color: "primary.main" }} />
          )}
          <Typography
            variant="caption"
            sx={{
              color: "primary.main",
              fontWeight: 600,
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {post.community.name}
          </Typography>
        </Box>
      )}

      {/* User Info Header */}
      <Box
        sx={{
          px: 2,
          pt: post.community ? 0.5 : 1.5,
          pb: 1,
          display: "flex",
          alignItems: "flex-start",
          gap: 1.5,
        }}
      >
        <Avatar
          sx={{
            width: 40,
            height: 40,
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/profile/${post.user?.handle || post.user?.publicId}`);
          }}
        >
          {post.user?.avatar ? (
            <img
              src={userAvatarUrl}
              alt={post.user.username}
              loading="lazy"
              decoding="async"
              width={40}
              height={40}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <span>{post.user?.username?.charAt(0).toUpperCase()}</span>
          )}
        </Avatar>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {post.type === "repost" && post.repostOf?.user && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.25 }}
            >
              {t("post.reposted_from", {
                username: post.repostOf.user.username,
              })}
            </Typography>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 700,
                color: "text.primary",
                "&:hover": { textDecoration: "underline" },
              }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(
                  `/profile/${post.user?.handle || post.user?.publicId}`,
                );
              }}
            >
              {post.user?.username || t("post.unknown_user")}
            </Typography>
            {post.authorCommunityRole === "admin" && (
              <Chip
                icon={<AdminPanelSettingsIcon sx={{ fontSize: 14 }} />}
                label="Admin"
                size="small"
                color="primary"
                variant="outlined"
                sx={{
                  height: 18,
                  fontSize: "0.65rem",
                  "& .MuiChip-icon": { width: 14, height: 14 },
                }}
              />
            )}
            {post.authorCommunityRole === "moderator" && (
              <Chip
                label="Mod"
                size="small"
                color="secondary"
                variant="outlined"
                sx={{ height: 18, fontSize: "0.65rem" }}
              />
            )}
            <Typography variant="body2" color="text.secondary">
              {new Date(post.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </Typography>

            {isAdmin && (
              <Tooltip
                title={t("admin.delete_post", {
                  defaultValue: "Delete Post (Admin)",
                })}
              >
                <IconButton
                  size="small"
                  onClick={handleDeletePost}
                  sx={{
                    ml: "auto",
                    color: "error.main",
                    padding: 0.5,
                    "&:hover": { bgcolor: "rgba(244, 33, 46, 0.1)" },
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>

          {/* Post Content */}
          {post.body && (
            <Typography
              variant="body1"
              sx={{
                color: "text.primary",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                mb: hasImage ? 1.5 : 0,
              }}
            >
              <RichText
                text={
                  isExpanded || !post.body || post.body.length <= 280
                    ? post.body
                    : post.body.slice(0, 280) + "..."
                }
              />
              {post.body && post.body.length > 280 && !isExpanded && (
                <Box
                  component="span"
                  sx={{
                    color: "primary.main",
                    cursor: "pointer",
                    ml: 0.5,
                    fontWeight: 500,
                    "&:hover": { textDecoration: "underline" },
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(true);
                  }}
                >
                  {t("post.show_more")}
                </Box>
              )}
            </Typography>
          )}

          {/* Image Display */}
          {hasImage && (
            <Box
              sx={{
                mt: 1.5,
                borderRadius: 3,
                overflow: "hidden",
                border: "1px solid",
                borderColor: "divider",
                width: "100%",
                maxHeight: "600px",
                display: "flex",
                justifyContent: "center",
                bgcolor: "black",
              }}
            >
              <img
                src={postImageUrl}
                srcSet={postImageSrcSet}
                sizes="(max-width: 600px) 100vw, 553px"
                alt={post.body?.substring(0, 50) || post.publicId}
                loading={shouldPrioritizeImage ? "eager" : "lazy"}
                fetchPriority={shouldPrioritizeImage ? "high" : "auto"}
                decoding="async"
                style={{
                  width: "100%",
                  height: "auto",
                  maxHeight: "600px",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </Box>
          )}

          {/* Reposted Content */}
          {post.type === "repost" && post.repostOf && (
            <Box
              sx={{
                mt: 1.5,
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 3,
                p: 1.5,
                cursor: "pointer",
                "&:hover": {
                  bgcolor: "rgba(255, 255, 255, 0.03)",
                },
              }}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/posts/${post.repostOf!.publicId}`);
              }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
                <Avatar sx={{ width: 24, height: 24 }} src={repostAvatarUrl}>
                  {post.repostOf.user.username.charAt(0).toUpperCase()}
                </Avatar>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {post.repostOf.user.username}
                </Typography>
              </Box>

              {post.repostOf.body && (
                <Typography
                  variant="body2"
                  sx={{ mb: post.repostOf.image ? 1.5 : 0 }}
                >
                  <RichText text={post.repostOf.body} />
                </Typography>
              )}

              {post.repostOf.image && (
                <Box
                  sx={{
                    borderRadius: 2,
                    overflow: "hidden",
                    width: "100%",
                    maxHeight: "400px",
                    display: "flex",
                    justifyContent: "center",
                    bgcolor: "black",
                  }}
                >
                  <img
                    src={repostImageUrl}
                    srcSet={repostImageSrcSet}
                    sizes="(max-width: 600px) 100vw, 511px"
                    alt={t("post.reposted_content")}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      height: "auto",
                      maxHeight: "400px",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </Box>
              )}

              {/* Original Post Stats */}
              <Box
                sx={{ display: "flex", gap: 2, mt: 1, color: "text.secondary" }}
              >
                <Typography variant="caption">
                  {formatCount(post.repostOf.likes || 0)} {t("post.likes")}
                </Typography>
                <Typography variant="caption">
                  {formatCount(post.repostOf.repostCount || 0)}{" "}
                  {t("post.reposts")}
                </Typography>
                <Typography variant="caption">
                  {formatCount(post.repostOf.commentsCount || 0)}{" "}
                  {t("post.comments")}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Card Actions - Stats */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              maxWidth: 520,
              mt: 1.5,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: "text.secondary",
                "&:hover": { color: "#0ea5e9" },
              }}
            >
              <FavoriteIcon fontSize="small" sx={{ fontSize: 18 }} />
              <Typography variant="caption">
                {formatCount(post.likes || 0)}
              </Typography>
            </Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: hasReposted ? "#22c55e" : "text.secondary",
                "&:hover": { color: "#22c55e" },
                cursor: "pointer",
              }}
              onClick={handleRepostClick}
            >
              <RepeatIcon fontSize="small" sx={{ fontSize: 18 }} />
              <Typography variant="caption">
                {formatCount(post.repostCount || 0)}
              </Typography>
            </Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: "text.secondary",
                "&:hover": { color: "#3b82f6" },
              }}
            >
              <CommentIcon fontSize="small" sx={{ fontSize: 18 }} />
              <Typography variant="caption">
                {formatCount(post.commentsCount || 0)}
              </Typography>
            </Box>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                color: "text.secondary",
                "&:hover": { color: "#0ea5e9" },
              }}
            >
              <VisibilityIcon fontSize="small" sx={{ fontSize: 18 }} />
              <Typography variant="caption">
                {formatCount(post.viewsCount || 0)}
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default PostCard;
