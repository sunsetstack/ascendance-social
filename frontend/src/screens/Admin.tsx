import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Tabs,
  Tab,
  Card,
  CardContent,
  Grid,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  IconButton,
  Avatar,
  TablePagination,
  CircularProgress,
  useTheme,
  Stack,
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Image as ImageIcon,
  Delete as DeleteIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  AdminPanelSettings as AdminPanelSettingsIcon,
  RemoveCircle as RemoveCircleIcon,
  Person as PersonIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
  Search as SearchIcon,
} from "@mui/icons-material";
import {
  useAdminUsers,
  useAdminImages,
  useDashboardStats,
  useRecentActivity,
  useBanUser,
  useUnbanUser,
  usePromoteToAdmin,
  useDemoteFromAdmin,
  useDeleteUserAdmin,
  useDeleteImageAdmin,
  useClearCache,
  useTelemetryMetrics,
  useRequestLogs,
} from "../hooks/admin/useAdmin";
import { AdminUserDTO, IPost } from "../types";
import { formatDistanceToNow } from "date-fns";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, value, index }) => (
  <div hidden={value !== index}>
    {value === index && <Box sx={{ py: 3 }}>{children}</Box>}
  </div>
);

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, change, icon }) => {
  const theme = useTheme();
  const isPositive = change?.startsWith("+");

  return (
    <Card
      sx={{
        background: `linear-gradient(145deg, ${theme.palette.background.paper} 0%, ${theme.palette.background.default} 100%)`,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      <CardContent>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            mb: 2,
          }}
        >
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontWeight: 500 }}
          >
            {title}
          </Typography>
          <Box sx={{ color: "primary.main", opacity: 0.8 }}>{icon}</Box>
        </Box>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
          {value}
        </Typography>
        {change && (
          <Typography
            variant="body2"
            sx={{ color: isPositive ? "success.main" : "error.main" }}
          >
            {change}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
};

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState(0);

  // User Tab State
  const [userPage, setUserPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [userSearch, setUserSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserDTO | null>(null);
  const [banReason, setBanReason] = useState("");

  // Image Tab State
  const [imagePage, setImagePage] = useState(0);

  // Logs Tab State
  const [logsPage, setLogsPage] = useState(0);
  const [logsRowsPerPage, setLogsRowsPerPage] = useState(50);
  const [logsMethodFilter, setLogsMethodFilter] = useState<string>("");
  const [logsStatusFilter, setLogsStatusFilter] = useState<string>("");
  const [logsSearch, setLogsSearch] = useState("");
  const [logsStartDate, setLogsStartDate] = useState("");
  const [logsEndDate, setLogsEndDate] = useState("");

  // Queries
  const { data: stats, isLoading: statsLoading } = useDashboardStats();

  const { data: usersData, isLoading: usersLoading } = useAdminUsers({
    page: userPage + 1,
    limit: rowsPerPage,
    search: userSearch,
    sortBy,
    sortOrder,
  });

  const { data: imagesData, isLoading: imagesLoading } = useAdminImages({
    page: imagePage + 1,
    limit: rowsPerPage,
  });

  const { data: activityData } = useRecentActivity({ page: 1, limit: 10 });
  const { data: telemetryData, isLoading: telemetryLoading } =
    useTelemetryMetrics();

  const { data: requestLogsData, isLoading: logsLoading } = useRequestLogs({
    page: logsPage + 1,
    limit: logsRowsPerPage,
    statusCode: logsStatusFilter ? parseInt(logsStatusFilter) : undefined,
    search: logsSearch,
    startDate: logsStartDate || undefined,
    endDate: logsEndDate || undefined,
  });

  // Mutations
  const banUserMutation = useBanUser();
  const unbanUserMutation = useUnbanUser();
  const promoteUserMutation = usePromoteToAdmin();
  const demoteUserMutation = useDemoteFromAdmin();
  const deleteUserMutation = useDeleteUserAdmin();
  const deleteImageMutation = useDeleteImageAdmin();
  const clearCacheMutation = useClearCache();

  const handleBanUser = () => {
    if (selectedUser && banReason.trim()) {
      banUserMutation.mutate(
        { publicId: selectedUser.publicId, reason: banReason },
        {
          onSuccess: () => {
            setBanDialogOpen(false);
            setBanReason("");
            setSelectedUser(null);
          },
        },
      );
    }
  };

  const openBanDialog = (user: AdminUserDTO) => {
    setSelectedUser(user);
    setBanDialogOpen(true);
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 4 }}>
        <Typography
          variant="h4"
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 1 }}
        >
          <AdminPanelSettingsIcon fontSize="large" />
          admin dashboard
        </Typography>
      </Box>

      <Tabs
        value={currentTab}
        onChange={(_, newValue) => setCurrentTab(newValue)}
        sx={{ mb: 3 }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
      >
        <Tab icon={<DashboardIcon />} label="overview" />
        <Tab icon={<PeopleIcon />} label="users" />
        <Tab icon={<ImageIcon />} label="posts" />
        <Tab icon={<SpeedIcon />} label="telemetry" />
        <Tab icon={<StorageIcon />} label="logs" />
      </Tabs>

      {/* overview tab */}
      <TabPanel value={currentTab} index={0}>
        {statsLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={3}>
            <Grid item xs={12} sm={6} md={3}>
              <StatCard
                title="Total Users"
                value={stats?.totalUsers || 0}
                change={`+${stats?.recentUsers || 0} this month`}
                icon={<PersonIcon sx={{ fontSize: 40 }} />}
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <StatCard
                title="Total Posts"
                value={stats?.totalImages || 0}
                change={`+${stats?.recentImages || 0} this month`}
                icon={<ImageIcon sx={{ fontSize: 40 }} />}
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <StatCard
                title="Banned Users"
                value={stats?.bannedUsers || 0}
                icon={<BlockIcon sx={{ fontSize: 40 }} />}
              />
            </Grid>

            <Grid item xs={12} sm={6} md={3}>
              <StatCard
                title="Admin Users"
                value={stats?.adminUsers || 0}
                icon={<AdminPanelSettingsIcon sx={{ fontSize: 40 }} />}
              />
            </Grid>

            {/* Removed fake chart as per request */}

            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      mb: 2,
                    }}
                  >
                    <Typography variant="h6">cache management</Typography>
                    <Button
                      variant="contained"
                      color="warning"
                      onClick={() => clearCacheMutation.mutate("feed:*")}
                      disabled={clearCacheMutation.isPending}
                    >
                      {clearCacheMutation.isPending
                        ? "clearing..."
                        : "clear feed cache"}
                    </Button>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    clear Redis cache to force feed regeneration. useful when
                    feed data seems stale after deletions or updates.
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Recent activity
                  </Typography>
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>user</TableCell>
                          <TableCell>action</TableCell>
                          <TableCell>target</TableCell>
                          <TableCell>time</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {activityData?.data.slice(0, 5).map((activity, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{activity.username}</TableCell>
                            <TableCell>{activity.action}</TableCell>
                            <TableCell>{activity.targetType}</TableCell>
                            <TableCell>
                              {formatDistanceToNow(
                                new Date(activity.timestamp),
                                { addSuffix: true },
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </TabPanel>

      {/* users tab */}
      <TabPanel value={currentTab} index={1}>
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{ mb: 2 }}
              alignItems={{ xs: "stretch", sm: "center" }}
            >
              <TextField
                size="small"
                label="Search Users"
                placeholder="Username or Email"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <SearchIcon
                      color="action"
                      fontSize="small"
                      sx={{ mr: 1 }}
                    />
                  ),
                }}
                sx={{ width: { xs: "100%", sm: 300 } }}
              />
              <TextField
                select
                size="small"
                label="Sort By"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                sx={{ width: { xs: "100%", sm: 150 } }}
                SelectProps={{ native: true }}
              >
                <option value="createdAt">Joined Date</option>
                <option value="postCount">Post Count</option>
                <option value="lastActive">Last Active</option>
                <option value="followerCount">Followers</option>
              </TextField>
              <TextField
                select
                size="small"
                label="Order"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "asc" | "desc")}
                sx={{ width: { xs: "100%", sm: 120 } }}
                SelectProps={{ native: true }}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </TextField>
              <Button
                variant="outlined"
                onClick={() => {
                  setUserSearch("");
                  setSortBy("createdAt");
                  setSortOrder("desc");
                }}
              >
                Reset
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {usersLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>user</TableCell>
                    <TableCell>email</TableCell>
                    <TableCell>posts</TableCell>
                    <TableCell>status</TableCell>
                    <TableCell>joined</TableCell>
                    <TableCell>actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {usersData?.data.map((user) => (
                    <TableRow
                      key={user.publicId}
                      hover
                      sx={{ cursor: "pointer" }}
                      onClick={() => navigate(`/admin/users/${user.publicId}`)}
                    >
                      <TableCell>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Avatar
                            src={user.avatar}
                            sx={{ width: 32, height: 32 }}
                          >
                            {user.username.charAt(0).toUpperCase()}
                          </Avatar>
                          <Box>
                            <Typography variant="body2" fontWeight="bold">
                              {user.username}
                            </Typography>
                            {user.isAdmin && (
                              <Chip
                                label="admin"
                                size="small"
                                color="warning"
                                sx={{ height: 20, fontSize: "0.625rem" }}
                              />
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.postCount}</TableCell>
                      <TableCell>
                        {user.isBanned ? (
                          <Chip label="banned" size="small" color="error" />
                        ) : (
                          <Chip label="active" size="small" color="success" />
                        )}
                      </TableCell>
                      <TableCell>
                        {formatDistanceToNow(new Date(user.createdAt), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Box sx={{ display: "flex", gap: 1 }}>
                          {user.isBanned ? (
                            <IconButton
                              size="small"
                              color="success"
                              onClick={() =>
                                unbanUserMutation.mutate(user.publicId)
                              }
                              title="unban user"
                            >
                              <CheckCircleIcon />
                            </IconButton>
                          ) : (
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => openBanDialog(user)}
                              title="ban user"
                            >
                              <BlockIcon />
                            </IconButton>
                          )}
                          {user.isAdmin ? (
                            <IconButton
                              size="small"
                              onClick={() =>
                                demoteUserMutation.mutate(user.publicId)
                              }
                              title="remove admin"
                            >
                              <RemoveCircleIcon />
                            </IconButton>
                          ) : (
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() =>
                                promoteUserMutation.mutate(user.publicId)
                              }
                              title="make admin"
                            >
                              <AdminPanelSettingsIcon />
                            </IconButton>
                          )}
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `delete user ${user.username}? this cannot be undone.`,
                                )
                              ) {
                                deleteUserMutation.mutate(user.publicId);
                              }
                            }}
                            title="delete user"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={usersData?.total || 0}
              page={userPage}
              onPageChange={(_, newPage) => setUserPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setUserPage(0);
              }}
            />
          </Paper>
        )}
      </TabPanel>

      {/* images tab */}
      <TabPanel value={currentTab} index={2}>
        {imagesLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Paper>
            <TableContainer>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>preview</TableCell>
                    <TableCell>content</TableCell>
                    <TableCell>author</TableCell>
                    <TableCell>likes</TableCell>
                    <TableCell>posted</TableCell>
                    <TableCell>actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {imagesData?.data.map((post: IPost) => {
                    const imageUrl = post.image?.url || post.url;
                    const hasImage = !!imageUrl;
                    const contentPreview = post.body
                      ? post.body.length > 50
                        ? post.body.substring(0, 50) + "..."
                        : post.body
                      : hasImage
                        ? "[image only]"
                        : "[no content]";
                    return (
                      <TableRow
                        key={post.publicId}
                        sx={{
                          cursor: "pointer",
                          "&:hover": { bgcolor: "rgba(255,255,255,0.05)" },
                        }}
                        onClick={() => navigate(`/posts/${post.publicId}`)}
                      >
                        <TableCell>
                          {hasImage ? (
                            <Avatar
                              variant="rounded"
                              src={imageUrl}
                              sx={{ width: 60, height: 60 }}
                            />
                          ) : (
                            <Avatar
                              variant="rounded"
                              sx={{
                                width: 60,
                                height: 60,
                                bgcolor: "grey.800",
                              }}
                            >
                              <ImageIcon />
                            </Avatar>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ maxWidth: 200 }}>
                            {contentPreview}
                          </Typography>
                        </TableCell>
                        <TableCell
                          onClick={(e) => {
                            e.stopPropagation();
                            if (post.user?.publicId) {
                              navigate(
                                `/profile/${post.user.handle || post.user.publicId}`,
                              );
                            }
                          }}
                          sx={{
                            "&:hover": {
                              color: "primary.main",
                              textDecoration: "underline",
                            },
                          }}
                        >
                          {post.user?.username}
                        </TableCell>
                        <TableCell>{post.likes || 0}</TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(post.createdAt), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => {
                              if (
                                window.confirm(
                                  "delete this post? this cannot be undone.",
                                )
                              ) {
                                deleteImageMutation.mutate(post.publicId);
                              }
                            }}
                            title="delete post"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={imagesData?.total || 0}
              page={imagePage}
              onPageChange={(_, newPage) => setImagePage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setImagePage(0);
              }}
            />
          </Paper>
        )}
      </TabPanel>

      {/* telemetry tab */}
      <TabPanel value={currentTab} index={3}>
        {telemetryLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={3}>
            {/* TTFI metrics */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Time to First Interaction (TTFI)
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    Measures how quickly users can interact with the page after
                    loading
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={6} sm={2.4}>
                      <Box
                        sx={{
                          textAlign: "center",
                          p: 2,
                          bgcolor: "background.default",
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="h4" color="primary.main">
                          {telemetryData?.ttfi.count || 0}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Samples
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box
                        sx={{
                          textAlign: "center",
                          p: 2,
                          bgcolor: "background.default",
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="h4" color="primary.main">
                          {telemetryData?.ttfi.avg || 0}ms
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Average
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box
                        sx={{
                          textAlign: "center",
                          p: 2,
                          bgcolor: "background.default",
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="h4" color="success.main">
                          {telemetryData?.ttfi.p50 || 0}ms
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          P50
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box
                        sx={{
                          textAlign: "center",
                          p: 2,
                          bgcolor: "background.default",
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="h4" color="warning.main">
                          {telemetryData?.ttfi.p90 || 0}ms
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          P90
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={6} sm={2.4}>
                      <Box
                        sx={{
                          textAlign: "center",
                          p: 2,
                          bgcolor: "background.default",
                          borderRadius: 1,
                        }}
                      >
                        <Typography variant="h4" color="error.main">
                          {telemetryData?.ttfi.p99 || 0}ms
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          P99
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* user flows */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    User Flows
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    Tracks completion rates of key user journeys
                  </Typography>
                  {telemetryData?.flows && telemetryData.flows.length > 0 ? (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Flow</TableCell>
                            <TableCell align="right">Started</TableCell>
                            <TableCell align="right">Completed</TableCell>
                            <TableCell align="right">Abandoned</TableCell>
                            <TableCell align="right">Completion Rate</TableCell>
                            <TableCell align="right">Avg Duration</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {telemetryData.flows.map((flow) => (
                            <TableRow key={flow.flowType}>
                              <TableCell>
                                <Chip
                                  label={flow.flowType}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                              <TableCell align="right">
                                {flow.started}
                              </TableCell>
                              <TableCell align="right">
                                {flow.completed}
                              </TableCell>
                              <TableCell align="right">
                                {flow.abandoned}
                              </TableCell>
                              <TableCell align="right">
                                <Chip
                                  label={`${flow.completionRate}%`}
                                  size="small"
                                  color={
                                    flow.completionRate >= 70
                                      ? "success"
                                      : flow.completionRate >= 40
                                        ? "warning"
                                        : "error"
                                  }
                                />
                              </TableCell>
                              <TableCell align="right">
                                {flow.avgDuration > 0
                                  ? `${(flow.avgDuration / 1000).toFixed(1)}s`
                                  : "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ textAlign: "center", py: 4 }}
                    >
                      No flow data available yet
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* scroll depth */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Scroll Depth
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    How far users scroll through feeds
                  </Typography>
                  {telemetryData?.scrollDepth &&
                  telemetryData.scrollDepth.length > 0 ? (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Feed</TableCell>
                            <TableCell align="right">Avg Depth</TableCell>
                            <TableCell align="right">25%</TableCell>
                            <TableCell align="right">50%</TableCell>
                            <TableCell align="right">75%</TableCell>
                            <TableCell align="right">100%</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {telemetryData.scrollDepth.map((scroll) => (
                            <TableRow key={scroll.feedId}>
                              <TableCell>
                                <Chip
                                  label={scroll.feedId}
                                  size="small"
                                  variant="outlined"
                                />
                              </TableCell>
                              <TableCell align="right">
                                {scroll.avgMaxDepth}%
                              </TableCell>
                              <TableCell align="right">
                                {scroll.reachedThresholds[25] || 0}
                              </TableCell>
                              <TableCell align="right">
                                {scroll.reachedThresholds[50] || 0}
                              </TableCell>
                              <TableCell align="right">
                                {scroll.reachedThresholds[75] || 0}
                              </TableCell>
                              <TableCell align="right">
                                {scroll.reachedThresholds[100] || 0}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  ) : (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ textAlign: "center", py: 4 }}
                    >
                      No scroll data available yet
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>

            {/* bucket info */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Typography variant="body2" color="text.secondary">
                      Data bucket age:{" "}
                      {telemetryData?.bucketAge
                        ? Math.round(telemetryData.bucketAge / 1000)
                        : 0}
                      s (resets every 5 minutes)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Auto-refreshes every 60s
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </TabPanel>

      {/* logs tab */}
      <TabPanel value={currentTab} index={4}>
        <Card>
          <CardContent>
            <Box
              sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                justifyContent: "space-between",
                alignItems: { xs: "flex-start", sm: "center" },
                mb: 2,
                gap: 2,
              }}
            >
              <Typography
                variant="h6"
                sx={{ display: "flex", alignItems: "center", gap: 1 }}
              >
                <StorageIcon />
                request logs
              </Typography>
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  flexWrap: "wrap",
                  alignItems: "center",
                  width: { xs: "100%", sm: "auto" },
                }}
              >
                <TextField
                  size="small"
                  label="Search"
                  value={logsSearch}
                  onChange={(e) => {
                    setLogsSearch(e.target.value);
                    setLogsPage(0);
                  }}
                  InputProps={{
                    startAdornment: (
                      <SearchIcon
                        color="action"
                        fontSize="small"
                        sx={{ mr: 1 }}
                      />
                    ),
                  }}
                  sx={{ width: { xs: "100%", sm: 200 } }}
                />
                <TextField
                  type="date"
                  size="small"
                  label="Start Date"
                  value={logsStartDate}
                  onChange={(e) => {
                    setLogsStartDate(e.target.value);
                    setLogsPage(0);
                  }}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: { xs: "calc(50% - 4px)", sm: 150 } }}
                />
                <TextField
                  type="date"
                  size="small"
                  label="End Date"
                  value={logsEndDate}
                  onChange={(e) => {
                    setLogsEndDate(e.target.value);
                    setLogsPage(0);
                  }}
                  InputLabelProps={{ shrink: true }}
                  sx={{ width: { xs: "calc(50% - 4px)", sm: 150 } }}
                />
                <TextField
                  select
                  size="small"
                  value={logsMethodFilter}
                  onChange={(e) => {
                    setLogsMethodFilter(e.target.value);
                    setLogsPage(0);
                  }}
                  SelectProps={{ native: true }}
                  sx={{ minWidth: 100, flexGrow: 1 }}
                >
                  <option value="">Method: All</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </TextField>
                <TextField
                  select
                  size="small"
                  value={logsStatusFilter}
                  onChange={(e) => {
                    setLogsStatusFilter(e.target.value);
                    setLogsPage(0);
                  }}
                  SelectProps={{ native: true }}
                  sx={{ minWidth: 100, flexGrow: 1 }}
                >
                  <option value="">Status: All</option>
                  <option value="200">200 OK</option>
                  <option value="201">201 Created</option>
                  <option value="400">400 Bad Request</option>
                  <option value="401">401 Unauthorized</option>
                  <option value="403">403 Forbidden</option>
                  <option value="404">404 Not Found</option>
                  <option value="500">500 Server Error</option>
                </TextField>
              </Box>
            </Box>
            {logsLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>timestamp</TableCell>
                        <TableCell>method</TableCell>
                        <TableCell>route</TableCell>
                        <TableCell>status</TableCell>
                        <TableCell>time (ms)</TableCell>
                        <TableCell>ip</TableCell>
                        <TableCell>user / email</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {requestLogsData?.data
                        .filter(
                          (log) =>
                            !logsMethodFilter ||
                            log.method === logsMethodFilter,
                        )
                        .map((log, idx) => {
                          const statusColor =
                            log.statusCode >= 500
                              ? "error"
                              : log.statusCode >= 400
                                ? "warning"
                                : log.statusCode >= 300
                                  ? "info"
                                  : "success";
                          return (
                            <TableRow key={idx}>
                              <TableCell sx={{ fontSize: "0.75rem" }}>
                                {new Date(log.timestamp).toLocaleString()}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={log.method}
                                  size="small"
                                  sx={{ fontWeight: 600, minWidth: 65 }}
                                />
                              </TableCell>
                              <TableCell
                                sx={{
                                  fontSize: "0.75rem",
                                  fontFamily: "monospace",
                                }}
                              >
                                {log.route}
                              </TableCell>
                              <TableCell>
                                <Chip
                                  label={log.statusCode}
                                  size="small"
                                  color={statusColor}
                                />
                              </TableCell>
                              <TableCell>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    color:
                                      log.responseTimeMs > 1000
                                        ? "error.main"
                                        : log.responseTimeMs > 500
                                          ? "warning.main"
                                          : "success.main",
                                    fontWeight: 600,
                                  }}
                                >
                                  {log.responseTimeMs}
                                </Typography>
                              </TableCell>
                              <TableCell
                                sx={{
                                  fontSize: "0.75rem",
                                  fontFamily: "monospace",
                                }}
                              >
                                {log.ip}
                              </TableCell>
                              <TableCell>
                                {log.userId ? (
                                  <Box
                                    sx={{
                                      display: "flex",
                                      flexDirection: "column",
                                    }}
                                  >
                                    <Chip
                                      label="auth"
                                      size="small"
                                      color="primary"
                                      sx={{ width: "fit-content", mb: 0.5 }}
                                    />
                                  </Box>
                                ) : (
                                  <Chip
                                    label="anon"
                                    size="small"
                                    variant="outlined"
                                  />
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={requestLogsData?.total || 0}
                  page={logsPage}
                  onPageChange={(_, newPage) => setLogsPage(newPage)}
                  rowsPerPage={logsRowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setLogsRowsPerPage(parseInt(e.target.value, 10));
                    setLogsPage(0);
                  }}
                  rowsPerPageOptions={[25, 50, 100]}
                />
              </>
            )}
          </CardContent>
        </Card>
      </TabPanel>

      {/* ban user dialog */}
      <Dialog
        open={banDialogOpen}
        onClose={() => setBanDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>ban user: {selectedUser?.username}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="ban reason"
            fullWidth
            multiline
            rows={3}
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="provide reason for ban"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBanDialogOpen(false)}>cancel</Button>
          <Button
            onClick={handleBanUser}
            variant="contained"
            color="error"
            disabled={!banReason.trim() || banUserMutation.isPending}
          >
            {banUserMutation.isPending ? "banning..." : "ban user"}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};
