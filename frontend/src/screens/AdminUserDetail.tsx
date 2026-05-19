import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Grid,
  Avatar,
  Chip,
  Button,
  Divider,
  CircularProgress,
  Link,
  Tabs,
  Tab,
  Paper,
  Pagination,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
} from "@mui/material";
import {
  ArrowBack as ArrowBackIcon,
  Email as EmailIcon,
  CalendarToday as CalendarTodayIcon,
  Delete as DeleteIcon,
  Sort as SortIcon,
} from "@mui/icons-material";
import { useAdminUser, useUserStats, useRemoveUserFavoriteAdmin } from "../hooks/admin/useAdmin";
import { useUserPostsPage, useUserCommentsPage, useUserLikedPostsPage } from "../hooks/user/useUsers";
import { formatDistanceToNow } from "date-fns";
import Gallery from "../components/Gallery";
import CommentItem from "../components/comments/CommentItem";
import { IComment, IPost } from "../types";

const AdminUserDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = React.useState(0);

  // Pagination & Sorting state
  const [pageSize, setPageSize] = React.useState(10);
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">("desc");
  const [postsPage, setPostsPage] = React.useState(1);
  const [commentsPage, setCommentsPage] = React.useState(1);
  const [likesPage, setLikesPage] = React.useState(1);

  const { data: user, isLoading: userLoading } = useAdminUser(id);
  const { data: stats, isLoading: statsLoading } = useUserStats(id);

  const {
    data: postsData,
    isLoading: postsLoading,
  } = useUserPostsPage(user?.publicId || "", postsPage, {
    enabled: !!user?.publicId && activeTab === 0,
    limit: pageSize,
    sortOrder: sortOrder,
  });

  const {
    data: commentsData,
    isLoading: commentsLoading,
  } = useUserCommentsPage(user?.publicId || "", commentsPage, {
    enabled: !!user?.publicId && activeTab === 1,
    limit: pageSize,
    sortOrder: sortOrder,
  });

  const {
    data: likesData,
    isLoading: likesLoading,
  } = useUserLikedPostsPage(user?.publicId || "", likesPage, {
    enabled: !!user?.publicId && activeTab === 2,
    limit: pageSize,
    sortOrder: sortOrder,
  });

  const removeFavoriteMutation = useRemoveUserFavoriteAdmin();

  const handleRemoveFavorite = (postPublicId: string) => {
    if (user?.publicId) {
      removeFavoriteMutation.mutate({ userPublicId: user.publicId, postPublicId });
    }
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  if (userLoading || statsLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Typography variant="h5">User not found</Typography>
        <Button onClick={() => navigate("/admin")} startIcon={<ArrowBackIcon />} sx={{ mt: 2 }}>
          Back to Dashboard
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Button onClick={() => navigate("/admin")} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to Dashboard
      </Button>

      <Grid container spacing={3}>
        {/* Header Card */}
        <Grid item xs={12}>
          <Card sx={{ bgcolor: "#000000", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: { xs: "flex-start", sm: "center" }, flexDirection: { xs: "column", sm: "row" }, gap: 3 }}>
                <Avatar src={user.avatar} sx={{ width: 100, height: 100 }} />
                <Box>
                  <Link
                    component={RouterLink}
                    to={`/profile/${user.handle || user.publicId}`}
                    underline="hover"
                    color="inherit"
                  >
                    <Typography variant="h4" gutterBottom>
                      {user.username}
                    </Typography>
                  </Link>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
                    <Chip
                      label={user.isAdmin ? "Admin" : "User"}
                      color={user.isAdmin ? "warning" : "default"}
                      size="small"
                    />
                    <Chip
                      label={user.isBanned ? "Banned" : "Active"}
                      color={user.isBanned ? "error" : "success"}
                      size="small"
                    />
                    <Chip label={user.isEmailVerified ? "Verified" : "Unverified"} size="small" variant="outlined" />
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary" }}>
                    <EmailIcon fontSize="small" />
                    <Typography variant="body2">{user.email}</Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", mt: 0.5 }}>
                    <CalendarTodayIcon fontSize="small" />
                    <Typography variant="body2">
                      Joined {new Date(user.createdAt).toLocaleDateString()} (
                      {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })})
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "text.secondary", mt: 0.5 }}>
                    <Typography variant="body2" sx={{ fontSize: "0.875rem" }}>
                      Last Active:{" "}
                      {stats?.lastActivity
                        ? formatDistanceToNow(new Date(stats.lastActivity), { addSuffix: true })
                        : "N/A"}
                    </Typography>
                  </Box>
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      ID: {user.publicId}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Stats Cards */}
        <Grid item xs={12} md={6}>
          <Card sx={{ height: "100%", bgcolor: "#000000", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Account Statistics
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Total Posts
                  </Typography>
                  <Typography variant="h6">{stats?.imageCount || 0}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Total Likes Received
                  </Typography>
                  <Typography variant="h6">{stats?.likeCount || 0}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Followers
                  </Typography>
                  <Typography variant="h6">{stats?.followerCount || 0}</Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="text.secondary">
                    Following
                  </Typography>
                  <Typography variant="h6">{stats?.followingCount || 0}</Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card sx={{ height: "100%", bgcolor: "#000000", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Security & Info
              </Typography>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Registration Date
                  </Typography>
                  <Typography variant="body2">{new Date(user.createdAt).toLocaleString()}</Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Registration IP
                  </Typography>
                  <Typography variant="body2">{user.registrationIp || "N/A"}</Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Last Activity
                  </Typography>
                  <Typography variant="body2">
                    {stats?.lastActivity
                      ? `${new Date(stats.lastActivity).toLocaleString()} (${formatDistanceToNow(
                        new Date(stats.lastActivity),
                        { addSuffix: true },
                      )})`
                      : "N/A"}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography variant="body2" color="text.secondary">
                    Last IP
                  </Typography>
                  <Typography variant="body2">{stats?.lastIp || "N/A"}</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Paper sx={{ mt: 4, borderRadius: 2, bgcolor: "#000000", border: "1px solid", borderColor: "divider" }}>
        <Box sx={{ p: 2, display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 2, justifyContent: "space-between", alignItems: { xs: "flex-start", sm: "center" }, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="h6">User Activity</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ xs: "stretch", sm: "center" }} sx={{ width: { xs: "100%", sm: "auto" } }}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>Sort Order</InputLabel>
              <Select
                value={sortOrder}
                label="Sort Order"
                onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                startAdornment={<SortIcon sx={{ mr: 1, color: "text.secondary" }} />}
              >
                <MenuItem value="desc">Newest First</MenuItem>
                <MenuItem value="asc">Oldest First</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>Per Page</InputLabel>
              <Select
                value={pageSize}
                label="Per Page"
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPostsPage(1);
                  setCommentsPage(1);
                  setLikesPage(1);
                }}
              >
                <MenuItem value={5}>5</MenuItem>
                <MenuItem value={10}>10</MenuItem>
                <MenuItem value={20}>20</MenuItem>
                <MenuItem value={50}>50</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </Box>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="fullWidth"
          indicatorColor="primary"
          textColor="primary"
        >
          <Tab label={`Posts (${stats?.imageCount || 0})`} />
          <Tab label="Comments" />
          <Tab label="Liked Posts" />
        </Tabs>

        <Box sx={{ p: 2 }}>
          {activeTab === 0 && (
            <Box>
              {postsLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>
              ) : postsData?.data.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  No posts found
                </Typography>
              ) : (
                <>
                  <Gallery
                    posts={postsData?.data || []}
                    fetchNextPage={() => { }}
                    hasNextPage={false}
                    isLoadingAll={false}
                  />
                  {postsData && postsData.totalPages > 1 && (
                    <Box sx={{ display: "flex", justifyContent: "center", mt: 3, pb: 2 }}>
                      <Pagination
                        count={postsData.totalPages}
                        page={postsPage}
                        onChange={(_, page) => setPostsPage(page)}
                        color="primary"
                      />
                    </Box>
                  )}
                </>
              )}
            </Box>
          )}

          {activeTab === 1 && (
            <Box>
              {commentsLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>
              ) : commentsData?.comments.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  No comments found
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {commentsData?.comments.map((comment: IComment) => (
                    <CommentItem key={comment.id} comment={comment} />
                  ))}
                  {commentsData && commentsData.totalPages > 1 && (
                    <Box sx={{ display: "flex", justifyContent: "center", mt: 3, pb: 2 }}>
                      <Pagination
                        count={commentsData.totalPages}
                        page={commentsPage}
                        onChange={(_, page) => setCommentsPage(page)}
                        color="primary"
                      />
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}

          {activeTab === 2 && (
            <Box>
              {likesLoading ? (
                <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}><CircularProgress /></Box>
              ) : likesData?.data.length === 0 ? (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  No liked posts found
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {likesData?.data.map((post: IPost) => (
                    <Paper key={post.publicId} sx={{ p: 1, display: "flex", alignItems: "center", gap: 2, bgcolor: "#000000", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
                      {post.image?.url && (
                        <Box
                          component="img"
                          src={post.image.url.startsWith("http") ? post.image.url : `/api/${post.image.url}`}
                          alt={post.body?.substring(0, 50) || "Post image"}
                          sx={{ width: 50, height: 50, borderRadius: 1, objectFit: "cover" }}
                        />
                      )}
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" noWrap>
                          {post.body || "No content"}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          by @{post.user?.handle || "unknown"}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<DeleteIcon />}
                        onClick={() => handleRemoveFavorite(post.publicId)}
                      >
                        Remove Like
                      </Button>
                      <Button
                        size="small"
                        onClick={() => navigate(`/posts/${post.publicId}`)}
                      >
                        View
                      </Button>
                    </Paper>
                  ))}
                  {likesData && likesData.totalPages > 1 && (
                    <Box sx={{ display: "flex", justifyContent: "center", mt: 3, pb: 2 }}>
                      <Pagination
                        count={likesData.totalPages}
                        page={likesPage}
                        onChange={(_, page) => setLikesPage(page)}
                        color="primary"
                      />
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Paper>
    </Container>
  );
};

export default AdminUserDetail;
