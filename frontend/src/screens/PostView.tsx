import { useEffect, useState } from "react";
import { useParams, Link as RouterLink, useNavigate } from "react-router-dom";
import { usePostById } from "../hooks/posts/usePosts";
import { useLikePost, useFavoritePost } from "../hooks/user/useUserAction";
import { useAuth } from "../hooks/context/useAuth";
import {
  useDeletePost,
  useRepostPost,
  useUnrepostPost,
} from "../hooks/posts/usePosts";
import RichText from "../components/RichText";
import { devError } from "@/lib/devLogger";
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Alert,
  IconButton,
  Avatar,
  Modal,
  useTheme,
  Chip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import BookmarkIcon from "@mui/icons-material/Bookmark";
import BookmarkBorderIcon from "@mui/icons-material/BookmarkBorder";
import DeleteIcon from "@mui/icons-material/Delete";
import RepeatIcon from "@mui/icons-material/Repeat";
import GroupsIcon from "@mui/icons-material/Groups";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import CommentSection from "../components/comments/CommentSection";
import { PageSeo, buildPostMetadata } from "../lib/seo";
import {
  buildMediaUrl,
  buildResponsiveCloudinarySrcSet,
  transformCloudinaryUrl,
} from "../lib/media";

const PostView = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isLoggedIn } = useAuth();
  const theme = useTheme();

  const { data: post, isLoading, isError, error } = usePostById(id || "");
  const { mutate: likePostMutation } = useLikePost();
  const { mutate: toggleFavoriteMutation } = useFavoritePost();
  const deleteMutation = useDeletePost();
  const { mutate: triggerRepost } = useRepostPost();
  const { mutate: triggerUnrepost } = useUnrepostPost();

  const [isFavorited, setIsFavorited] = useState<boolean>(
    post?.isFavoritedByViewer ?? false,
  );
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const seoMetadata = buildPostMetadata({
    id,
    body: post?.body,
    authorHandle: post?.user?.handle,
    authorName: post?.user?.username,
    image: post?.url || post?.image?.url,
    communityName: post?.community?.name,
  });

  // syncing local state with server state only when the underlying post ID changes
  useEffect(() => {
    setIsFavorited(post?.isFavoritedByViewer ?? false);
  }, [post?.publicId, post?.isFavoritedByViewer]);

  if (isLoading) {
    return (
      <>
        <PageSeo {...seoMetadata} />
        <Box sx={{ mt: 4, display: "flex", justifyContent: "center" }}>
          <CircularProgress />
        </Box>
      </>
    );
  }

  if (isError || !post) {
    return (
      <>
        <PageSeo {...seoMetadata} />
        <Box sx={{ mt: 4, px: 2 }}>
          <Alert severity="error">
            Error loading post: {error?.message || "Post not found"}
          </Alert>
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate(-1)}
            sx={{ mt: 2 }}
          >
            Go Back
          </Button>
        </Box>
      </>
    );
  }

  const isOwner = isLoggedIn && user?.publicId === post.user.publicId;
  const isLiked = isLoggedIn && post.isLikedByViewer;
  const isOwnRepost =
    post.type === "repost" &&
    isLoggedIn &&
    post.user?.publicId === user?.publicId;
  const hasReposted = isOwnRepost || post.isRepostedByViewer;

  const avatarUrl = transformCloudinaryUrl(buildMediaUrl(post.user?.avatar), {
    width: 80,
    height: 80,
    crop: "fill",
  });
  const communityAvatarUrl = transformCloudinaryUrl(
    buildMediaUrl(post.community?.avatar),
    {
      width: 64,
      height: 64,
      crop: "fill",
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
  const displayName =
    post.user?.username || post.user?.publicId || "Unknown user";
  const profileHref = post.user?.handle
    ? `/profile/${post.user.handle}`
    : post.user?.publicId
      ? `/profile/${post.user.publicId}`
      : "/profile";

  // Handle optional image URL (post might be text-only)
  const fullImageUrl =
    buildMediaUrl(post.url) ?? buildMediaUrl(post.image?.url);
  const postImageUrl = transformCloudinaryUrl(fullImageUrl, {
    width: 1200,
    crop: "limit",
    dpr: false,
  });
  const postImageSrcSet = buildResponsiveCloudinarySrcSet(
    fullImageUrl,
    [480, 640, 768, 960, 1200],
    { crop: "limit" },
  );
  const repostImageRawUrl = buildMediaUrl(post.repostOf?.image?.url);
  const repostImageUrl = transformCloudinaryUrl(repostImageRawUrl, {
    width: 900,
    crop: "limit",
    dpr: false,
  });
  const repostImageSrcSet = buildResponsiveCloudinarySrcSet(
    repostImageRawUrl,
    [320, 480, 640, 800, 960],
    { crop: "limit" },
  );
  const modalImageUrl = transformCloudinaryUrl(fullImageUrl, {
    width: 1920,
    crop: "limit",
  });

  const hasImage = !!fullImageUrl;

  const handleLikePost = () => {
    if (!isLoggedIn) return navigate("/login");
    likePostMutation(post.publicId);
  };

  const handleRepostClick = () => {
    if (!isLoggedIn) {
      navigate("/login");
      return;
    }

    // For repost cards, target the original post
    const targetId =
      post.type === "repost" && post.repostOf?.publicId
        ? post.repostOf.publicId
        : post.publicId;

    if (hasReposted) {
      triggerUnrepost(
        { postPublicId: targetId },
        {
          onSuccess: () => {
            // If viewing own repost, it's now deleted — navigate back
            if (isOwnRepost) navigate(-1);
          },
        },
      );
    } else {
      triggerRepost({ postPublicId: targetId });
    }
  };

  const handleToggleFavorite = () => {
    if (!isLoggedIn) return navigate("/login");
    toggleFavoriteMutation({
      publicId: post.publicId,
      shouldFavorite: !isFavorited,
    });
  };

  const handleDeletePost = () => {
    if (isOwner) {
      deleteMutation.mutate(post.publicId, {
        onSuccess: () => navigate(-1),
        onError: (err) => devError("Delete failed", err),
      });
    }
  };

  return (
    <>
      <PageSeo {...seoMetadata} />
      <Box sx={{ minHeight: "100%", bgcolor: "background.default" }}>
        {/* Sticky Header */}
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 1000,
            bgcolor: "rgba(0, 0, 0, 0.65)",
            backdropFilter: "blur(12px)",
            borderBottom: `1px solid ${theme.palette.divider}`,
            px: 2,
            py: 1,
            display: "flex",
            alignItems: "center",
            gap: 3,
          }}
        >
          <IconButton onClick={() => navigate(-1)} size="small">
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" fontWeight={700}>
            Post
          </Typography>
        </Box>

        <Box sx={{ px: 2, py: 2 }}>
          {/* Community Badge */}
          {post.community && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                mb: 1.5,
                cursor: "pointer",
              }}
              onClick={() => navigate(`/communities/${post.community!.slug}`)}
            >
              {post.community.avatar ? (
                <Avatar
                  src={communityAvatarUrl}
                  sx={{ width: 18, height: 18 }}
                />
              ) : (
                <GroupsIcon sx={{ fontSize: 18, color: "primary.main" }} />
              )}
              <Typography
                variant="body2"
                sx={{
                  color: "primary.main",
                  fontWeight: 600,
                  "&:hover": { textDecoration: "underline" },
                }}
              >
                {post.community.name}
              </Typography>
            </Box>
          )}

          {/* User Info */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Avatar
                component={RouterLink}
                to={profileHref}
                src={avatarUrl}
                sx={{ width: 40, height: 40, cursor: "pointer" }}
              >
                {!avatarUrl && (
                  <span>{displayName.charAt(0).toUpperCase()}</span>
                )}
              </Avatar>
              <Box>
                <Typography
                  component={RouterLink}
                  to={profileHref}
                  variant="subtitle1"
                  sx={{
                    fontWeight: 700,
                    color: "text.primary",
                    textDecoration: "none",
                    lineHeight: 1.2,
                    "&:hover": { textDecoration: "underline" },
                  }}
                >
                  {displayName}
                </Typography>
                {post.authorCommunityRole === "admin" && (
                  <Chip
                    icon={<AdminPanelSettingsIcon sx={{ fontSize: 14 }} />}
                    label="Admin"
                    size="small"
                    color="primary"
                    variant="outlined"
                    sx={{
                      ml: 1,
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
                    sx={{ ml: 1, height: 18, fontSize: "0.65rem" }}
                  />
                )}
                <Typography variant="body2" color="text.secondary">
                  @{post.user?.handle}
                </Typography>
              </Box>
            </Box>
            {(isOwner || post.canDelete) && (
              <IconButton
                size="small"
                color="error"
                onClick={handleDeletePost}
                disabled={deleteMutation.isPending}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Box>

          {/* Post Body */}
          {post.body && (
            <Typography
              variant="body1"
              sx={{
                mt: 2,
                fontSize: "1.05rem",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              <RichText text={post.body} />
            </Typography>
          )}

          {/* Image */}
          {hasImage && (
            <Box
              sx={{
                mt: 2,
                borderRadius: 4,
                overflow: "hidden",
                border: `1px solid ${theme.palette.divider}`,
                cursor: "pointer",
                maxHeight: "600px",
                width: "100%",
                display: "flex",
                justifyContent: "center",
                bgcolor: "black",
              }}
              onClick={() => setIsImageModalOpen(true)}
            >
              <img
                src={postImageUrl}
                srcSet={postImageSrcSet}
                sizes="(max-width: 600px) 100vw, 553px"
                alt="Post content"
                loading="eager"
                fetchPriority="high"
                decoding="async"
                style={{
                  width: "100%",
                  height: "auto",
                  maxHeight: "600px",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </Box>
          )}

          {post.type === "repost" && post.repostOf && (
            <Box
              sx={{
                mt: 2,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 3,
                p: 1.5,
                cursor: "pointer",
                "&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
              }}
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/posts/${post.repostOf!.publicId}`);
              }}
            >
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}
              >
                <Avatar sx={{ width: 24, height: 24 }} src={repostAvatarUrl}>
                  {(post.repostOf.user?.username || "U")
                    .charAt(0)
                    .toUpperCase()}
                </Avatar>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {post.repostOf.user?.username || "Unknown"}
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
                    alt="Reposted content"
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

              <Box
                sx={{ display: "flex", gap: 2, mt: 1, color: "text.secondary" }}
              >
                <Typography variant="caption">
                  {post.repostOf.likes || 0} Likes
                </Typography>
                <Typography variant="caption">
                  {post.repostOf.repostCount || 0} Reposts
                </Typography>
                <Typography variant="caption">
                  {post.repostOf.commentsCount || 0} Comments
                </Typography>
              </Box>
            </Box>
          )}

          {/* Date */}
          <Box
            sx={{
              mt: 2,
              py: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {new Date(post.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ·{" "}
              {new Date(post.createdAt).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}{" "}
              ·{" "}
              <span
                style={{ color: theme.palette.text.primary, fontWeight: 600 }}
              >
                {post.viewsCount || 0}
              </span>{" "}
              {post.viewsCount === 1 ? "View" : "Views"}
            </Typography>
          </Box>

          {/* Stats (Likes/Comments/Reposts) */}
          {(post.likes > 0 ||
            post.commentsCount > 0 ||
            (post.repostCount || 0) > 0) && (
            <Box
              sx={{
                py: 1.5,
                borderBottom: `1px solid ${theme.palette.divider}`,
                display: "flex",
                gap: 3,
              }}
            >
              {post.likes > 0 && (
                <Typography variant="body2" color="text.secondary">
                  <span
                    style={{
                      color: theme.palette.text.primary,
                      fontWeight: 700,
                    }}
                  >
                    {post.likes}
                  </span>{" "}
                  Likes
                </Typography>
              )}
              {(post.repostCount || 0) > 0 && (
                <Typography variant="body2" color="text.secondary">
                  <span
                    style={{
                      color: theme.palette.text.primary,
                      fontWeight: 700,
                    }}
                  >
                    {post.repostCount}
                  </span>{" "}
                  Reposts
                </Typography>
              )}
              {post.commentsCount > 0 && (
                <Typography variant="body2" color="text.secondary">
                  <span
                    style={{
                      color: theme.palette.text.primary,
                      fontWeight: 700,
                    }}
                  >
                    {post.commentsCount}
                  </span>{" "}
                  Comments
                </Typography>
              )}
            </Box>
          )}

          {/* Action Buttons */}
          <Box
            sx={{
              py: 1,
              borderBottom: `1px solid ${theme.palette.divider}`,
              display: "flex",
              justifyContent: "space-around",
            }}
          >
            <IconButton
              onClick={handleLikePost}
              color={isLiked ? "primary" : "default"}
            >
              {isLiked ? <FavoriteIcon /> : <FavoriteBorderIcon />}
            </IconButton>
            <IconButton
              onClick={handleRepostClick}
              sx={{ color: hasReposted ? "#22c55e" : "default" }}
            >
              <RepeatIcon />
            </IconButton>
            <IconButton
              onClick={handleToggleFavorite}
              color={isFavorited ? "primary" : "default"}
            >
              {isFavorited ? <BookmarkIcon /> : <BookmarkBorderIcon />}
            </IconButton>
          </Box>

          {/* Comment Section */}
          <Box sx={{ mt: 2 }}>
            <CommentSection
              postId={post.publicId}
              commentsCount={post.commentsCount}
            />
          </Box>
        </Box>

        {/* Image Modal */}
        <Modal
          open={isImageModalOpen}
          onClose={() => setIsImageModalOpen(false)}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0, 0, 0, 0.9)",
            backdropFilter: "blur(5px)",
          }}
        >
          <Box
            sx={{
              position: "relative",
              maxWidth: "100vw",
              maxHeight: "100vh",
              outline: "none",
              p: 2,
            }}
          >
            <IconButton
              onClick={() => setIsImageModalOpen(false)}
              sx={{
                position: "absolute",
                top: 20,
                right: 20,
                color: "white",
                bgcolor: "rgba(0, 0, 0, 0.5)",
                "&:hover": { bgcolor: "rgba(0, 0, 0, 0.7)" },
                zIndex: 1,
              }}
            >
              <CloseIcon />
            </IconButton>
            <img
              src={modalImageUrl}
              alt="Full size"
              loading="lazy"
              decoding="async"
              style={{
                maxWidth: "100%",
                maxHeight: "90vh",
                objectFit: "contain",
                display: "block",
                borderRadius: 8,
              }}
            />
          </Box>
        </Modal>
      </Box>
    </>
  );
};

export default PostView;
