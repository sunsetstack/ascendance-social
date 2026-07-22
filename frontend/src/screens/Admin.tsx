import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import {
  AdminPanelSettings as AdminPanelSettingsIcon,
  ArticleOutlined as ArticleIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as ContentCopyIcon,
  Dashboard as DashboardIcon,
  Delete as DeleteIcon,
  Image as ImageIcon,
  KeyOutlined as KeyIcon,
  ManageAccountsOutlined as ManageAccountsIcon,
  People as PeopleIcon,
  QueryStatsOutlined as QueryStatsIcon,
  Refresh as RefreshIcon,
  RemoveCircle as RemoveCircleIcon,
  Search as SearchIcon,
  SecurityOutlined as SecurityIcon,
  Speed as SpeedIcon,
  Storage as StorageIcon,
  WarningAmberOutlined as WarningAmberIcon,
} from "@mui/icons-material";
import { formatDistanceToNow } from "date-fns";
import {
  useAdminImages,
  useAdminUsers,
  useAuthActivityLogs,
  useBanUser,
  useClearCache,
  useDashboardStats,
  useDeleteImageAdmin,
  useDeleteUserAdmin,
  useDemoteFromAdmin,
  usePromoteToAdmin,
  useRecentActivity,
  useRequestLogs,
  useTelemetryMetrics,
  useUnbanUser,
} from "../hooks/admin/useAdmin";
import type { AuthActivityLog, RequestLog } from "../api/adminApi";
import { AdminUserDTO, IPost } from "../types";
import { buildAvatarUrl, transformCloudinaryUrl } from "../lib/media";

const MIN_TELEMETRY_SAMPLES = 20;

type AdminLog = RequestLog | AuthActivityLog;
type MetricTone = "primary" | "success" | "warning" | "error";

interface TabPanelProps {
  children: React.ReactNode;
  index: number;
  value: number;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  tone?: MetricTone;
}

interface PanelProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

const TabPanel: React.FC<TabPanelProps> = ({ children, index, value }) => (
  <Box hidden={value !== index}>{value === index ? children : null}</Box>
);

const formatCompactNumber = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const formatLatency = (value?: number): string => {
  if (value === undefined || value === null) return "—";
  return value >= 1000
    ? `${(value / 1000).toFixed(1)}s`
    : `${Math.round(value)}ms`;
};

const getStatusColor = (
  statusCode?: number,
): "success" | "warning" | "error" | "default" => {
  if (!statusCode) return "default";
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warning";
  if (statusCode >= 300) return "default";
  return "success";
};

const getLogIdentity = (log: AdminLog): string =>
  log.authUsername ||
  log.authHandle ||
  log.authEmail ||
  log.userId ||
  "Anonymous";

const getLogKey = (log: AdminLog, index: number): string =>
  log.correlationId || log.clientRequestId || `${log.timestamp}-${index}`;

const describeActivity = (action: string, targetType: string): string => {
  const labels: Record<string, string> = {
    upload: "uploaded a post",
    like: "liked a post",
    comment_like: "liked a comment",
    comment: "commented on a post",
    follow: "followed a user",
    unfollow: "unfollowed a user",
    favorite: "saved a post",
    unfavorite: "removed a saved post",
    profile_update: "updated their profile",
  };

  if (labels[action]) return labels[action];
  return targetType === "unknown"
    ? action.replace(/_/g, " ")
    : `${action.replace(/_/g, " ")} a ${targetType}`;
};

const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  detail,
  icon,
  tone = "primary",
}) => {
  const theme = useTheme();
  const colors: Record<MetricTone, string> = {
    primary: theme.palette.primary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
  };
  const color = colors[tone];

  return (
    <Paper
      sx={{
        p: 2.5,
        height: "100%",
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 3,
        background: `linear-gradient(145deg, ${theme.palette.background.paper}, rgba(14, 19, 26, 0.58))`,
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={2}
      >
        <Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontWeight: 700 }}
          >
            {label}
          </Typography>
          <Typography variant="h4" sx={{ mt: 1.2, fontWeight: 800 }}>
            {value}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.75 }}
          >
            {detail}
          </Typography>
        </Box>
        <Box
          sx={{
            display: "grid",
            placeItems: "center",
            width: 42,
            height: 42,
            borderRadius: 2,
            color,
            bgcolor: `${color}1c`,
          }}
        >
          {icon}
        </Box>
      </Stack>
    </Paper>
  );
};

const Panel: React.FC<PanelProps> = ({
  title,
  description,
  action,
  children,
}) => {
  const theme = useTheme();

  return (
    <Paper
      sx={{
        height: "100%",
        overflow: "hidden",
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: 3,
        backgroundColor: "rgba(14, 19, 26, 0.76)",
      }}
    >
      <Box
        sx={{
          px: 2.5,
          py: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h6">{title}</Typography>
            {description ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.35 }}
              >
                {description}
              </Typography>
            ) : null}
          </Box>
          {action}
        </Stack>
      </Box>
      {children}
    </Paper>
  );
};

const DetailValue: React.FC<{
  label: string;
  value?: string | number | boolean;
}> = ({ label, value }) => {
  if (value === undefined || value === null || value === "") return null;
  const displayValue =
    typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mb: 0.4 }}
      >
        {label}
      </Typography>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography
          variant="body2"
          sx={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            overflowWrap: "anywhere",
          }}
        >
          {displayValue}
        </Typography>
        {displayValue.length > 12 ? (
          <Tooltip title="Copy value">
            <IconButton
              aria-label={`Copy ${label}`}
              size="small"
              onClick={() => void navigator.clipboard?.writeText(displayValue)}
            >
              <ContentCopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  );
};

const LogDetailsDialog: React.FC<{
  log: AdminLog | null;
  onClose: () => void;
}> = ({ log, onClose }) => {
  if (!log) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Request details</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2.5}>
          <Grid item xs={12} sm={6}>
            <DetailValue
              label="Timestamp"
              value={new Date(log.timestamp).toLocaleString()}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Actor" value={getLogIdentity(log)} />
          </Grid>
          {"method" in log ? (
            <Grid item xs={12} sm={6}>
              <DetailValue label="Method" value={log.method} />
            </Grid>
          ) : (
            <Grid item xs={12} sm={6}>
              <DetailValue label="Auth event" value={log.action} />
            </Grid>
          )}
          <Grid item xs={12} sm={6}>
            <DetailValue label="Route" value={log.route} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Status" value={log.statusCode} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue
              label="Response time"
              value={formatLatency(log.responseTimeMs)}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Authentication state" value={log.authState} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Authentication source" value={log.authSource} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="IP address" value={log.ip} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Correlation ID" value={log.correlationId} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Session ID" value={log.sessionId} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Token family" value={log.tokenFamilyId} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue
              label="Client request ID"
              value={log.clientRequestId}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Client boot ID" value={log.clientBootId} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue
              label="Retry attempt"
              value={log.clientRequestAttempt}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Retried" value={log.axiosRetry} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue
              label="Refresh token rotated"
              value={log.refreshRotated}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Origin" value={log.origin} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Referrer" value={log.referer} />
          </Grid>
          <Grid item xs={12}>
            <DetailValue label="User agent" value={log.userAgent} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const theme = useTheme();
  const [currentTab, setCurrentTab] = useState(0);
  const [userPage, setUserPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [userSearch, setUserSearch] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(
    new Set(),
  );
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUserDTO | null>(null);
  const [banReason, setBanReason] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [deleteAllReason, setDeleteAllReason] = useState("");
  const [isDeletingSelectedUsers, setIsDeletingSelectedUsers] =
    useState(false);
  const [imagePage, setImagePage] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [logsRowsPerPage, setLogsRowsPerPage] = useState(50);
  const [logsMethodFilter, setLogsMethodFilter] = useState("");
  const [logsStatusFilter, setLogsStatusFilter] = useState("");
  const [logsSearch, setLogsSearch] = useState("");
  const [logsStartDate, setLogsStartDate] = useState("");
  const [logsEndDate, setLogsEndDate] = useState("");
  const [authLogsPage, setAuthLogsPage] = useState(0);
  const [authLogsRowsPerPage, setAuthLogsRowsPerPage] = useState(50);
  const [authLogsActionFilter, setAuthLogsActionFilter] = useState("");
  const [authLogsStatusFilter, setAuthLogsStatusFilter] = useState("");
  const [authLogsSearch, setAuthLogsSearch] = useState("");
  const [authLogsStartDate, setAuthLogsStartDate] = useState("");
  const [authLogsEndDate, setAuthLogsEndDate] = useState("");
  const [selectedLog, setSelectedLog] = useState<AdminLog | null>(null);

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useDashboardStats(currentTab === 0);
  const {
    data: usersData,
    isLoading: usersLoading,
    refetch: refetchUsers,
  } = useAdminUsers(
    {
      page: userPage + 1,
      limit: rowsPerPage,
      search: userSearch,
      sortBy,
      sortOrder,
    },
    currentTab === 1,
  );
  const {
    data: imagesData,
    isLoading: imagesLoading,
    refetch: refetchImages,
  } = useAdminImages(
    { page: imagePage + 1, limit: rowsPerPage },
    currentTab === 2,
  );
  const visibleUsers = usersData?.data ?? [];
  const selectedVisibleUserCount = visibleUsers.reduce(
    (count, user) => count + (selectedUserIds.has(user.publicId) ? 1 : 0),
    0,
  );
  const allVisibleUsersSelected =
    visibleUsers.length > 0 && selectedVisibleUserCount === visibleUsers.length;
  const someVisibleUsersSelected =
    selectedVisibleUserCount > 0 && !allVisibleUsersSelected;

  const toggleUserSelection = (publicId: string, checked: boolean) => {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(publicId);
      } else {
        next.delete(publicId);
      }
      return next;
    });
  };

  const toggleVisibleUserSelection = () => {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      visibleUsers.forEach((user) => {
        if (allVisibleUsersSelected) {
          next.delete(user.publicId);
        } else {
          next.add(user.publicId);
        }
      });
      return next;
    });
  };
  const { data: activityData, refetch: refetchActivity } = useRecentActivity(
    { page: 1, limit: 8 },
    currentTab === 0,
  );
  const {
    data: telemetryData,
    isLoading: telemetryLoading,
    refetch: refetchTelemetry,
  } = useTelemetryMetrics(currentTab === 3);
  const {
    data: requestLogsData,
    isLoading: logsLoading,
    refetch: refetchRequestLogs,
  } = useRequestLogs(
    {
      page: logsPage + 1,
      limit: logsRowsPerPage,
      method: logsMethodFilter || undefined,
      statusCode: logsStatusFilter ? parseInt(logsStatusFilter, 10) : undefined,
      search: logsSearch || undefined,
      startDate: logsStartDate || undefined,
      endDate: logsEndDate || undefined,
    },
    currentTab === 4,
  );
  const {
    data: authActivityLogsData,
    isLoading: authLogsLoading,
    refetch: refetchAuthLogs,
  } = useAuthActivityLogs(
    {
      page: authLogsPage + 1,
      limit: authLogsRowsPerPage,
      action: authLogsActionFilter || undefined,
      statusCode: authLogsStatusFilter
        ? parseInt(authLogsStatusFilter, 10)
        : undefined,
      search: authLogsSearch || undefined,
      startDate: authLogsStartDate || undefined,
      endDate: authLogsEndDate || undefined,
    },
    currentTab === 5,
  );

  const banUserMutation = useBanUser();
  const unbanUserMutation = useUnbanUser();
  const promoteUserMutation = usePromoteToAdmin();
  const demoteUserMutation = useDemoteFromAdmin();
  const deleteUserMutation = useDeleteUserAdmin();
  const deleteImageMutation = useDeleteImageAdmin();
  const clearCacheMutation = useClearCache();

  const operations = stats?.operations ?? {
    requestsLast24Hours: 0,
    serverErrorsLast24Hours: 0,
    slowRequestsLast24Hours: 0,
    averageResponseTimeMs: 0,
    failedAuthAttemptsLast24Hours: 0,
  };
  const hasOperationalConcern =
    operations.serverErrorsLast24Hours > 0 ||
    operations.slowRequestsLast24Hours > 0;
  const telemetryIsReliable =
    (telemetryData?.ttfi.count ?? 0) >= MIN_TELEMETRY_SAMPLES;

  const handleRefresh = (): void => {
    const refreshers = [
      [refetchStats, refetchActivity],
      [refetchUsers],
      [refetchImages],
      [refetchTelemetry],
      [refetchRequestLogs],
      [refetchAuthLogs],
    ][currentTab];
    void Promise.all(refreshers.map((refetch) => refetch()));
  };

  const openBanDialog = (user: AdminUserDTO): void => {
    setSelectedUser(user);
    setBanReason("");
    setBanDialogOpen(true);
  };

  const openDeleteDialog = (user: AdminUserDTO): void => {
    setSelectedUser(user);
    setDeleteReason("");
    setDeleteDialogOpen(true);
  };

  const handleBanUser = (): void => {
    if (!selectedUser || !banReason.trim()) return;
    banUserMutation.mutate(
      { publicId: selectedUser.publicId, reason: banReason.trim() },
      {
        onSuccess: () => {
          setBanDialogOpen(false);
          setSelectedUser(null);
          setBanReason("");
        },
      },
    );
  };

  const handleDeleteUser = (): void => {
    if (!selectedUser || !deleteReason.trim()) return;
    deleteUserMutation.mutate(
      { publicId: selectedUser.publicId, reason: deleteReason.trim() },
      {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setSelectedUser(null);
          setDeleteReason("");
        },
      },
    );
  };

  const handleDeleteAllUsers = async (): Promise<void> => {
    const publicIds = Array.from(selectedUserIds);
    const reason = deleteAllReason.trim();
    if (publicIds.length === 0 || !reason) return;

    setIsDeletingSelectedUsers(true);
    try {
      const results = await Promise.allSettled(
        publicIds.map((publicId) =>
          deleteUserMutation.mutateAsync({ publicId, reason }),
        ),
      );
      const deletedUserIds = new Set(
        results.flatMap((result, index) => {
          const publicId = publicIds[index];
          return result.status === "fulfilled" && publicId ? [publicId] : [];
        }),
      );

      if (deletedUserIds.size > 0) {
        setSelectedUserIds((current) => {
          const next = new Set(current);
          deletedUserIds.forEach((publicId) => next.delete(publicId));
          return next;
        });
      }

      if (deletedUserIds.size === publicIds.length) {
        setDeleteAllDialogOpen(false);
        setDeleteAllReason("");
      }
    } finally {
      setIsDeletingSelectedUsers(false);
    }
  };

  return (
    <Container
      maxWidth={false}
      sx={{ maxWidth: 1500, px: { xs: 2, sm: 3, lg: 4 }, py: { xs: 2, md: 4 } }}
    >
      <Box
        sx={{
          p: { xs: 2.25, sm: 3 },
          mb: 2.5,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 4,
          background:
            "radial-gradient(circle at top right, rgba(56, 189, 248, 0.16), transparent 34%), linear-gradient(135deg, rgba(14, 19, 26, 0.98), rgba(7, 9, 13, 0.9))",
        }}
      >
        <Stack
          direction={{ xs: "column", md: "row" }}
          alignItems={{ md: "center" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography
              variant="overline"
              color="primary.main"
              sx={{ fontWeight: 800, letterSpacing: 1.2 }}
            >
              Admin workspace
            </Typography>
            <Stack direction="row" spacing={1.25} alignItems="center">
              <AdminPanelSettingsIcon color="primary" fontSize="large" />
              <Typography variant="h3">Control center</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.8 }}>
              People, content, platform signals, and secure diagnostics in one
              place.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              icon={<SecurityIcon />}
              label="Admin only"
              color="primary"
              variant="outlined"
            />
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={handleRefresh}
            >
              Refresh
            </Button>
          </Stack>
        </Stack>
      </Box>

      <Tabs
        value={currentTab}
        onChange={(_, newValue) => setCurrentTab(newValue)}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 3,
          minHeight: 48,
          borderBottom: `1px solid ${theme.palette.divider}`,
          "& .MuiTabs-flexContainer": { gap: 0.5 },
          "& .MuiTab-root": {
            minHeight: 48,
            px: 1.5,
            textTransform: "none",
            fontWeight: 700,
            color: "text.secondary",
          },
          "& .Mui-selected": { color: "primary.main" },
          "& .MuiTabs-indicator": { height: 3, borderRadius: "3px 3px 0 0" },
        }}
      >
        <Tab icon={<DashboardIcon />} iconPosition="start" label="Overview" />
        <Tab icon={<PeopleIcon />} iconPosition="start" label="People" />
        <Tab icon={<ArticleIcon />} iconPosition="start" label="Content" />
        <Tab
          icon={<QueryStatsIcon />}
          iconPosition="start"
          label="Experience"
        />
        <Tab icon={<StorageIcon />} iconPosition="start" label="Requests" />
        <Tab icon={<KeyIcon />} iconPosition="start" label="Security" />
      </Tabs>

      <TabPanel value={currentTab} index={0}>
        {statsLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", minHeight: 320 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Grid container spacing={2.5}>
            <Grid item xs={12} sm={6} lg={3}>
              <MetricCard
                label="People"
                value={formatCompactNumber(stats?.totalUsers ?? 0)}
                detail={`${stats?.recentUsers ?? 0} joined in the last 30 days`}
                icon={<PeopleIcon />}
              />
            </Grid>
            <Grid item xs={12} sm={6} lg={3}>
              <MetricCard
                label="Posts"
                value={formatCompactNumber(stats?.totalImages ?? 0)}
                detail={`${stats?.recentImages ?? 0} published in the last 30 days`}
                icon={<ImageIcon />}
                tone="success"
              />
            </Grid>
            <Grid item xs={12} sm={6} lg={3}>
              <MetricCard
                label="Server errors"
                value={operations.serverErrorsLast24Hours}
                detail="Responses with a 5xx status in the last 24 hours"
                icon={<WarningAmberIcon />}
                tone={
                  operations.serverErrorsLast24Hours > 0 ? "error" : "success"
                }
              />
            </Grid>
            <Grid item xs={12} sm={6} lg={3}>
              <MetricCard
                label="Auth failures"
                value={operations.failedAuthAttemptsLast24Hours}
                detail="Unauthorized auth events in the last 24 hours"
                icon={<KeyIcon />}
                tone={
                  operations.failedAuthAttemptsLast24Hours > 0
                    ? "warning"
                    : "primary"
                }
              />
            </Grid>

            <Grid item xs={12} lg={7}>
              <Panel
                title="Platform pulse"
                description="A compact health readout built from the last 24 hours of request data."
                action={
                  <Button size="small" onClick={() => setCurrentTab(4)}>
                    Open requests
                  </Button>
                }
              >
                <Box sx={{ p: 2.5 }}>
                  <Alert
                    severity={hasOperationalConcern ? "warning" : "success"}
                    sx={{ mb: 2.5 }}
                  >
                    {hasOperationalConcern
                      ? "The platform has signals worth reviewing. Open Requests to inspect the affected routes."
                      : "No server errors or slow requests have been recorded in the last 24 hours."}
                  </Alert>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="h5">
                        {formatCompactNumber(operations.requestsLast24Hours)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Requests
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="h5">
                        {formatLatency(operations.averageResponseTimeMs)}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Average response time
                      </Typography>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                      <Typography variant="h5">
                        {operations.slowRequestsLast24Hours}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Slow requests over 1s
                      </Typography>
                    </Grid>
                  </Grid>
                </Box>
              </Panel>
            </Grid>

            <Grid item xs={12} lg={5}>
              <Panel
                title="Operator actions"
                description="Common tasks without burying maintenance in the overview."
              >
                <Stack spacing={1.1} sx={{ p: 2 }}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<ManageAccountsIcon />}
                    onClick={() => setCurrentTab(1)}
                  >
                    Review people
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<ArticleIcon />}
                    onClick={() => setCurrentTab(2)}
                  >
                    Review posts
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<SecurityIcon />}
                    onClick={() => setCurrentTab(5)}
                  >
                    Inspect security activity
                  </Button>
                  <Divider sx={{ my: 0.5 }} />
                  <Stack
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    spacing={2}
                  >
                    <Box>
                      <Typography variant="body2" fontWeight={700}>
                        Feed cache
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Use only when feeds remain stale after changes.
                      </Typography>
                    </Box>
                    <Button
                      color="warning"
                      variant="contained"
                      onClick={() => clearCacheMutation.mutate("feed:*")}
                      disabled={clearCacheMutation.isPending}
                    >
                      {clearCacheMutation.isPending ? "Clearing…" : "Clear"}
                    </Button>
                  </Stack>
                </Stack>
              </Panel>
            </Grid>

            <Grid item xs={12}>
              <Panel
                title="Recent activity"
                description="The latest visible community actions."
              >
                <Box sx={{ px: { xs: 2, sm: 2.5 }, py: 0.5 }}>
                  {activityData?.data.length ? (
                    activityData.data.map((activity, index) => (
                      <Stack
                        key={`${activity.userId}-${activity.timestamp}-${index}`}
                        direction="row"
                        spacing={1.5}
                        alignItems="center"
                        sx={{
                          py: 1.6,
                          borderBottom:
                            index < activityData.data.length - 1
                              ? `1px solid ${theme.palette.divider}`
                              : "none",
                        }}
                      >
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            flexShrink: 0,
                            borderRadius: "50%",
                            bgcolor: "primary.main",
                          }}
                        />
                        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                          <Typography variant="body2">
                            <Box component="span" sx={{ fontWeight: 800 }}>
                              {activity.username}
                            </Box>{" "}
                            {describeActivity(
                              activity.action,
                              activity.targetType,
                            )}
                          </Typography>
                        </Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ flexShrink: 0 }}
                        >
                          {formatDistanceToNow(new Date(activity.timestamp), {
                            addSuffix: true,
                          })}
                        </Typography>
                      </Stack>
                    ))
                  ) : (
                    <Typography
                      color="text.secondary"
                      sx={{ py: 4, textAlign: "center" }}
                    >
                      Community activity will appear here as members interact
                      with the app.
                    </Typography>
                  )}
                </Box>
              </Panel>
            </Grid>
          </Grid>
        )}
      </TabPanel>

      <TabPanel value={currentTab} index={1}>
        <Stack spacing={2.5}>
          <Panel
            title="People"
            description="Search accounts, review their activity, and apply account controls."
            action={
              selectedUserIds.size > 0 ? (
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  startIcon={<DeleteIcon />}
                  onClick={() => {
                    setDeleteAllReason("");
                    setDeleteAllDialogOpen(true);
                  }}
                >
                  Delete all
                </Button>
              ) : undefined
            }
          >
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1.25}
              sx={{ p: 2 }}
            >
              <TextField
                size="small"
                label="Search people"
                placeholder="Username or email"
                value={userSearch}
                onChange={(event) => {
                  setUserSearch(event.target.value);
                  setUserPage(0);
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
                sx={{ minWidth: { md: 260 }, flexGrow: 1 }}
              />
              <TextField
                select
                size="small"
                label="Sort"
                value={sortBy}
                onChange={(event) => {
                  setSortBy(event.target.value);
                  setUserPage(0);
                }}
                SelectProps={{ native: true }}
                sx={{ minWidth: 150 }}
              >
                <option value="createdAt">Joined date</option>
                <option value="updatedAt">Last updated</option>
                <option value="username">Username</option>
                <option value="email">Email</option>
              </TextField>
              <TextField
                select
                size="small"
                label="Order"
                value={sortOrder}
                onChange={(event) => {
                  setSortOrder(event.target.value as "asc" | "desc");
                  setUserPage(0);
                }}
                SelectProps={{ native: true }}
                sx={{ minWidth: 130 }}
              >
                <option value="desc">Newest first</option>
                <option value="asc">Oldest first</option>
              </TextField>
              <Button
                variant="text"
                onClick={() => {
                  setUserSearch("");
                  setSortBy("createdAt");
                  setSortOrder("desc");
                  setUserPage(0);
                }}
              >
                Reset
              </Button>
            </Stack>
          </Panel>

          {usersLoading ? (
            <Box sx={{ display: "grid", placeItems: "center", minHeight: 260 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Paper
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <TableContainer>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={allVisibleUsersSelected}
                          indeterminate={someVisibleUsersSelected}
                          onChange={toggleVisibleUserSelection}
                          inputProps={{
                            "aria-label": "Select all visible accounts",
                          }}
                        />
                      </TableCell>
                      <TableCell>Person</TableCell>
                      <TableCell>Email</TableCell>
                      <TableCell align="right">Posts</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Joined</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visibleUsers.map((user) => (
                      <TableRow
                        key={user.publicId}
                        hover
                        sx={{ cursor: "pointer" }}
                        onClick={() =>
                          navigate(`/admin/users/${user.publicId}`)
                        }
                      >
                        <TableCell
                          padding="checkbox"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedUserIds.has(user.publicId)}
                            onChange={(event) =>
                              toggleUserSelection(
                                user.publicId,
                                event.target.checked,
                              )
                            }
                            inputProps={{
                              "aria-label": `Select ${user.username}`,
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Stack
                            direction="row"
                            spacing={1.25}
                            alignItems="center"
                          >
                            <Avatar
                              src={buildAvatarUrl(user.avatar, 36)}
                              sx={{ width: 36, height: 36 }}
                            >
                              {user.username.charAt(0).toUpperCase()}
                            </Avatar>
                            <Box>
                              <Typography variant="body2" fontWeight={800}>
                                {user.username}
                              </Typography>
                              {user.isAdmin ? (
                                <Chip
                                  label="Admin"
                                  size="small"
                                  color="warning"
                                  sx={{ mt: 0.35, height: 20 }}
                                />
                              ) : null}
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell align="right">{user.postCount}</TableCell>
                        <TableCell>
                          <Chip
                            label={user.isBanned ? "Banned" : "Active"}
                            size="small"
                            color={user.isBanned ? "error" : "success"}
                          />
                        </TableCell>
                        <TableCell>
                          {formatDistanceToNow(new Date(user.createdAt), {
                            addSuffix: true,
                          })}
                        </TableCell>
                        <TableCell
                          align="right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Stack
                            direction="row"
                            spacing={0.25}
                            justifyContent="flex-end"
                          >
                            {user.isBanned ? (
                              <Tooltip title="Restore account">
                                <IconButton
                                  aria-label="Restore account"
                                  size="small"
                                  color="success"
                                  onClick={() =>
                                    unbanUserMutation.mutate(user.publicId)
                                  }
                                >
                                  <CheckCircleIcon />
                                </IconButton>
                              </Tooltip>
                            ) : (
                              <Tooltip title="Ban account">
                                <IconButton
                                  aria-label="Ban account"
                                  size="small"
                                  color="error"
                                  onClick={() => openBanDialog(user)}
                                >
                                  <BlockIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            {user.isAdmin ? (
                              <Tooltip title="Remove administrator access">
                                <IconButton
                                  aria-label="Remove administrator access"
                                  size="small"
                                  onClick={() =>
                                    demoteUserMutation.mutate(user.publicId)
                                  }
                                >
                                  <RemoveCircleIcon />
                                </IconButton>
                              </Tooltip>
                            ) : (
                              <Tooltip title="Make administrator">
                                <IconButton
                                  aria-label="Make administrator"
                                  size="small"
                                  color="warning"
                                  onClick={() =>
                                    promoteUserMutation.mutate(user.publicId)
                                  }
                                >
                                  <AdminPanelSettingsIcon />
                                </IconButton>
                              </Tooltip>
                            )}
                            <Tooltip title="Permanently delete account">
                              <IconButton
                                aria-label="Permanently delete account"
                                size="small"
                                color="error"
                                onClick={() => openDeleteDialog(user)}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={usersData?.total ?? 0}
                page={userPage}
                onPageChange={(_, page) => setUserPage(page)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(parseInt(event.target.value, 10));
                  setUserPage(0);
                }}
                rowsPerPageOptions={[10, 25, 50]}
              />
            </Paper>
          )}
        </Stack>
      </TabPanel>

      <TabPanel value={currentTab} index={2}>
        <Stack spacing={2.5}>
          <Panel
            title="Content library"
            description="Review posts as members see them. Open a row to inspect the post before removing it."
            action={
              <Chip label={`${imagesData?.total ?? 0} posts`} size="small" />
            }
          >
            <Box sx={{ display: "none" }} />
          </Panel>
          {imagesLoading ? (
            <Box sx={{ display: "grid", placeItems: "center", minHeight: 260 }}>
              <CircularProgress />
            </Box>
          ) : (
            <Paper
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <TableContainer>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Preview</TableCell>
                      <TableCell>Post</TableCell>
                      <TableCell>Author</TableCell>
                      <TableCell align="right">Likes</TableCell>
                      <TableCell>Published</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {imagesData?.data.map((post: IPost) => {
                      const imageUrl = post.image?.url || post.url;
                      const hasImage = Boolean(imageUrl);
                      const contentPreview = post.body
                        ? post.body.length > 90
                          ? `${post.body.substring(0, 90)}…`
                          : post.body
                        : hasImage
                          ? "Image post"
                          : "No caption";
                      return (
                        <TableRow
                          key={post.publicId}
                          hover
                          sx={{ cursor: "pointer" }}
                          onClick={() => navigate(`/posts/${post.publicId}`)}
                        >
                          <TableCell>
                            <Avatar
                              variant="rounded"
                              src={
                                hasImage
                                  ? transformCloudinaryUrl(imageUrl, {
                                      width: 120,
                                      height: 120,
                                      crop: "fill",
                                      quality: "auto:eco",
                                      dpr: false,
                                    })
                                  : undefined
                              }
                              sx={{
                                width: 56,
                                height: 56,
                                bgcolor: "grey.800",
                              }}
                            >
                              <ImageIcon />
                            </Avatar>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2" sx={{ maxWidth: 360 }}>
                              {contentPreview}
                            </Typography>
                          </TableCell>
                          <TableCell
                            onClick={(event) => {
                              event.stopPropagation();
                              if (post.user?.publicId)
                                navigate(
                                  `/profile/${post.user.handle || post.user.publicId}`,
                                );
                            }}
                            sx={{
                              "&:hover": {
                                color: "primary.main",
                                textDecoration: "underline",
                              },
                            }}
                          >
                            {post.user?.username || "Unknown"}
                          </TableCell>
                          <TableCell align="right">{post.likes || 0}</TableCell>
                          <TableCell>
                            {formatDistanceToNow(new Date(post.createdAt), {
                              addSuffix: true,
                            })}
                          </TableCell>
                          <TableCell
                            align="right"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Tooltip title="Delete post">
                              <IconButton
                                aria-label="Delete post"
                                size="small"
                                color="error"
                                onClick={() => {
                                  if (
                                    window.confirm(
                                      "Delete this post? This cannot be undone.",
                                    )
                                  )
                                    deleteImageMutation.mutate(post.publicId);
                                }}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={imagesData?.total ?? 0}
                page={imagePage}
                onPageChange={(_, page) => setImagePage(page)}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(parseInt(event.target.value, 10));
                  setImagePage(0);
                }}
                rowsPerPageOptions={[10, 25, 50]}
              />
            </Paper>
          )}
        </Stack>
      </TabPanel>

      <TabPanel value={currentTab} index={3}>
        {telemetryLoading ? (
          <Box sx={{ display: "grid", placeItems: "center", minHeight: 320 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Stack spacing={2.5}>
            <Panel
              title="Experience signals"
              description="A live, rolling view of browser telemetry rather than a historical analytics report."
              action={
                <Chip
                  label={`${telemetryData?.ttfi.count ?? 0} samples`}
                  size="small"
                  color={telemetryIsReliable ? "success" : "warning"}
                />
              }
            >
              <Box sx={{ p: 2.5 }}>
                <Alert severity={telemetryIsReliable ? "info" : "warning"}>
                  {telemetryIsReliable
                    ? "Percentiles are shown only after enough current-session samples have been collected."
                    : `Need ${MIN_TELEMETRY_SAMPLES} samples before treating interaction percentiles as meaningful. This window currently resets every five minutes.`}
                </Alert>
              </Box>
            </Panel>
            <Grid container spacing={2.5}>
              <Grid item xs={12} sm={6} lg={3}>
                <MetricCard
                  label="First interaction"
                  value={
                    telemetryIsReliable
                      ? formatLatency(telemetryData?.ttfi.avg)
                      : "—"
                  }
                  detail={
                    telemetryIsReliable
                      ? "Average delay in this live sample window"
                      : `${telemetryData?.ttfi.count ?? 0}/${MIN_TELEMETRY_SAMPLES} samples collected`
                  }
                  icon={<SpeedIcon />}
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <MetricCard
                  label="P50 interaction"
                  value={
                    telemetryIsReliable
                      ? formatLatency(telemetryData?.ttfi.p50)
                      : "—"
                  }
                  detail="Middle of the current sample window"
                  icon={<QueryStatsIcon />}
                  tone="success"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <MetricCard
                  label="P90 interaction"
                  value={
                    telemetryIsReliable
                      ? formatLatency(telemetryData?.ttfi.p90)
                      : "—"
                  }
                  detail="Slower experiences in the current window"
                  icon={<WarningAmberIcon />}
                  tone="warning"
                />
              </Grid>
              <Grid item xs={12} sm={6} lg={3}>
                <MetricCard
                  label="P99 interaction"
                  value={
                    telemetryIsReliable
                      ? formatLatency(telemetryData?.ttfi.p99)
                      : "—"
                  }
                  detail="Tail latency; only useful with enough samples"
                  icon={<WarningAmberIcon />}
                  tone="error"
                />
              </Grid>
            </Grid>
            <Grid container spacing={2.5}>
              <Grid item xs={12} lg={7}>
                <Panel
                  title="Key journeys"
                  description="Completion signals from the flows the client currently instruments."
                >
                  {telemetryData?.flows.length ? (
                    <Stack divider={<Divider flexItem />} sx={{ px: 2.5 }}>
                      {telemetryData.flows.map((flow) => (
                        <Box key={flow.flowType} sx={{ py: 2 }}>
                          <Stack
                            direction={{ xs: "column", sm: "row" }}
                            justifyContent="space-between"
                            spacing={1}
                          >
                            <Box>
                              <Typography fontWeight={800}>
                                {flow.flowType.replace(/_/g, " ")}
                              </Typography>
                              <Typography
                                variant="body2"
                                color="text.secondary"
                              >
                                {flow.completed} completed · {flow.abandoned}{" "}
                                abandoned ·{" "}
                                {flow.avgDuration
                                  ? formatLatency(flow.avgDuration)
                                  : "No duration yet"}
                              </Typography>
                            </Box>
                            <Chip
                              label={`${flow.completionRate}% complete`}
                              size="small"
                              color={
                                flow.completionRate >= 70
                                  ? "success"
                                  : flow.completionRate >= 40
                                    ? "warning"
                                    : "error"
                              }
                            />
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={flow.completionRate}
                            color={
                              flow.completionRate >= 70
                                ? "success"
                                : flow.completionRate >= 40
                                  ? "warning"
                                  : "error"
                            }
                            sx={{ mt: 1.4, height: 7, borderRadius: 999 }}
                          />
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography
                      color="text.secondary"
                      sx={{ py: 6, textAlign: "center" }}
                    >
                      No current flow samples. Instrumented journeys will appear
                      here as people use them.
                    </Typography>
                  )}
                </Panel>
              </Grid>
              <Grid item xs={12} lg={5}>
                <Panel
                  title="Feed depth"
                  description="How far people reach in each tracked feed."
                >
                  {telemetryData?.scrollDepth.length ? (
                    <Stack divider={<Divider flexItem />} sx={{ px: 2.5 }}>
                      {telemetryData.scrollDepth.map((scroll) => (
                        <Box key={scroll.feedId} sx={{ py: 2 }}>
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <Typography variant="body2" fontWeight={800}>
                              {scroll.feedId}
                            </Typography>
                            <Chip
                              label={`${scroll.avgMaxDepth}% average`}
                              size="small"
                            />
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={scroll.avgMaxDepth}
                            sx={{ mt: 1.2, height: 7, borderRadius: 999 }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", mt: 1 }}
                          >
                            {scroll.reachedThresholds[25] || 0} reached 25% ·{" "}
                            {scroll.reachedThresholds[50] || 0} reached 50% ·{" "}
                            {scroll.reachedThresholds[75] || 0} reached 75%
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Typography
                      color="text.secondary"
                      sx={{ py: 6, textAlign: "center" }}
                    >
                      No feed-depth samples in the current window.
                    </Typography>
                  )}
                </Panel>
              </Grid>
            </Grid>
          </Stack>
        )}
      </TabPanel>

      <TabPanel value={currentTab} index={4}>
        <Stack spacing={2.5}>
          <Panel
            title="Request traces"
            description="Start with route, status, latency, and actor. Open a row only when you need sensitive diagnostic identifiers."
          >
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.25}
              sx={{ p: 2 }}
            >
              <TextField
                size="small"
                label="Search requests"
                value={logsSearch}
                onChange={(event) => {
                  setLogsSearch(event.target.value);
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
                sx={{ flexGrow: 1, minWidth: { lg: 230 } }}
              />
              <TextField
                select
                size="small"
                value={logsMethodFilter}
                onChange={(event) => {
                  setLogsMethodFilter(event.target.value);
                  setLogsPage(0);
                }}
                SelectProps={{ native: true }}
                sx={{ minWidth: 125 }}
              >
                <option value="">Method: all</option>
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </TextField>
              <TextField
                select
                size="small"
                value={logsStatusFilter}
                onChange={(event) => {
                  setLogsStatusFilter(event.target.value);
                  setLogsPage(0);
                }}
                SelectProps={{ native: true }}
                sx={{ minWidth: 130 }}
              >
                <option value="">Status: all</option>
                <option value="200">200 OK</option>
                <option value="201">201 Created</option>
                <option value="400">400 Bad Request</option>
                <option value="401">401 Unauthorized</option>
                <option value="403">403 Forbidden</option>
                <option value="404">404 Not Found</option>
                <option value="500">500 Server error</option>
              </TextField>
              <TextField
                type="date"
                size="small"
                label="From"
                value={logsStartDate}
                onChange={(event) => {
                  setLogsStartDate(event.target.value);
                  setLogsPage(0);
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 145 }}
              />
              <TextField
                type="date"
                size="small"
                label="To"
                value={logsEndDate}
                onChange={(event) => {
                  setLogsEndDate(event.target.value);
                  setLogsPage(0);
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 145 }}
              />
            </Stack>
          </Panel>
          <Paper
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            {logsLoading ? (
              <Box
                sx={{ display: "grid", placeItems: "center", minHeight: 260 }}
              >
                <CircularProgress />
              </Box>
            ) : (
              <>
                <TableContainer sx={{ maxHeight: 640 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Request</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Latency</TableCell>
                        <TableCell>Actor</TableCell>
                        <TableCell align="right">Details</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {requestLogsData?.data.length ? (
                        requestLogsData.data.map((log, index) => (
                          <TableRow
                            key={getLogKey(log, index)}
                            hover
                            sx={{ cursor: "pointer" }}
                            onClick={() => setSelectedLog(log)}
                          >
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              {formatDistanceToNow(new Date(log.timestamp), {
                                addSuffix: true,
                              })}
                            </TableCell>
                            <TableCell>
                              <Stack
                                direction="row"
                                spacing={1}
                                alignItems="center"
                              >
                                <Chip label={log.method} size="small" />
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontFamily:
                                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                                    maxWidth: { xs: 140, md: 340 },
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {log.route}
                                </Typography>
                              </Stack>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={log.statusCode}
                                size="small"
                                color={getStatusColor(log.statusCode)}
                              />
                            </TableCell>
                            <TableCell
                              sx={{
                                color:
                                  log.responseTimeMs > 1000
                                    ? "error.main"
                                    : log.responseTimeMs > 500
                                      ? "warning.main"
                                      : "success.main",
                                fontWeight: 800,
                              }}
                            >
                              {formatLatency(log.responseTimeMs)}
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: 180 }}
                              >
                                {getLogIdentity(log)}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {log.authState || "unknown"}
                              </Typography>
                            </TableCell>
                            <TableCell
                              align="right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Tooltip title="Open diagnostics">
                                <IconButton
                                  aria-label="Open request diagnostics"
                                  size="small"
                                  onClick={() => setSelectedLog(log)}
                                >
                                  <StorageIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Typography
                              color="text.secondary"
                              sx={{ py: 4, textAlign: "center" }}
                            >
                              No requests match these filters.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={requestLogsData?.total ?? 0}
                  page={logsPage}
                  onPageChange={(_, page) => setLogsPage(page)}
                  rowsPerPage={logsRowsPerPage}
                  onRowsPerPageChange={(event) => {
                    setLogsRowsPerPage(parseInt(event.target.value, 10));
                    setLogsPage(0);
                  }}
                  rowsPerPageOptions={[25, 50, 100]}
                />
              </>
            )}
          </Paper>
        </Stack>
      </TabPanel>

      <TabPanel value={currentTab} index={5}>
        <Stack spacing={2.5}>
          <Panel
            title="Security activity"
            description="Authentication events and session outcomes. Identifiers stay in row details to keep the primary review surface focused."
          >
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.25}
              sx={{ p: 2 }}
            >
              <TextField
                size="small"
                label="Search security activity"
                value={authLogsSearch}
                onChange={(event) => {
                  setAuthLogsSearch(event.target.value);
                  setAuthLogsPage(0);
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
                sx={{ flexGrow: 1, minWidth: { lg: 230 } }}
              />
              <TextField
                size="small"
                label="Event"
                placeholder="refresh, login…"
                value={authLogsActionFilter}
                onChange={(event) => {
                  setAuthLogsActionFilter(event.target.value);
                  setAuthLogsPage(0);
                }}
                sx={{ minWidth: 150 }}
              />
              <TextField
                select
                size="small"
                value={authLogsStatusFilter}
                onChange={(event) => {
                  setAuthLogsStatusFilter(event.target.value);
                  setAuthLogsPage(0);
                }}
                SelectProps={{ native: true }}
                sx={{ minWidth: 125 }}
              >
                <option value="">Status: all</option>
                <option value="200">200 OK</option>
                <option value="201">201 Created</option>
                <option value="400">400 Bad Request</option>
                <option value="401">401 Unauthorized</option>
                <option value="403">403 Forbidden</option>
                <option value="500">500 Server error</option>
              </TextField>
              <TextField
                type="date"
                size="small"
                label="From"
                value={authLogsStartDate}
                onChange={(event) => {
                  setAuthLogsStartDate(event.target.value);
                  setAuthLogsPage(0);
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 145 }}
              />
              <TextField
                type="date"
                size="small"
                label="To"
                value={authLogsEndDate}
                onChange={(event) => {
                  setAuthLogsEndDate(event.target.value);
                  setAuthLogsPage(0);
                }}
                InputLabelProps={{ shrink: true }}
                sx={{ minWidth: 145 }}
              />
            </Stack>
          </Panel>
          <Paper
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            {authLogsLoading ? (
              <Box
                sx={{ display: "grid", placeItems: "center", minHeight: 260 }}
              >
                <CircularProgress />
              </Box>
            ) : (
              <>
                <TableContainer sx={{ maxHeight: 640 }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Time</TableCell>
                        <TableCell>Event</TableCell>
                        <TableCell>Route</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Actor</TableCell>
                        <TableCell align="right">Details</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {authActivityLogsData?.data.length ? (
                        authActivityLogsData.data.map((log, index) => (
                          <TableRow
                            key={getLogKey(log, index)}
                            hover
                            sx={{ cursor: "pointer" }}
                            onClick={() => setSelectedLog(log)}
                          >
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              {formatDistanceToNow(new Date(log.timestamp), {
                                addSuffix: true,
                              })}
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={log.action}
                                size="small"
                                variant="outlined"
                              />
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="body2"
                                sx={{
                                  fontFamily:
                                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                                  maxWidth: { xs: 130, md: 300 },
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {log.route || "—"}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Chip
                                label={log.statusCode ?? "—"}
                                size="small"
                                color={getStatusColor(log.statusCode)}
                              />
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="body2"
                                noWrap
                                sx={{ maxWidth: 180 }}
                              >
                                {getLogIdentity(log)}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {log.authState || "unknown"}
                              </Typography>
                            </TableCell>
                            <TableCell
                              align="right"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Tooltip title="Open security diagnostics">
                                <IconButton
                                  aria-label="Open security diagnostics"
                                  size="small"
                                  onClick={() => setSelectedLog(log)}
                                >
                                  <KeyIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <Typography
                              color="text.secondary"
                              sx={{ py: 4, textAlign: "center" }}
                            >
                              No authentication events match these filters.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={authActivityLogsData?.total ?? 0}
                  page={authLogsPage}
                  onPageChange={(_, page) => setAuthLogsPage(page)}
                  rowsPerPage={authLogsRowsPerPage}
                  onRowsPerPageChange={(event) => {
                    setAuthLogsRowsPerPage(parseInt(event.target.value, 10));
                    setAuthLogsPage(0);
                  }}
                  rowsPerPageOptions={[25, 50, 100]}
                />
              </>
            )}
          </Paper>
        </Stack>
      </TabPanel>

      <Dialog
        open={banDialogOpen}
        onClose={() => setBanDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Ban {selectedUser?.username}</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mt: 1, mb: 2 }}>
            Banning removes this account’s posts and social data. Comments and
            message history are anonymized for other members.
          </Alert>
          <TextField
            autoFocus
            margin="dense"
            label="Reason"
            fullWidth
            multiline
            rows={3}
            value={banReason}
            onChange={(event) => setBanReason(event.target.value)}
            placeholder="Provide a reason for the audit trail"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBanDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleBanUser}
            variant="contained"
            color="error"
            disabled={!banReason.trim() || banUserMutation.isPending}
          >
            {banUserMutation.isPending ? "Banning…" : "Ban account"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Permanently delete {selectedUser?.username}</DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mt: 1, mb: 2 }}>
            This permanently removes the account and owned content. The reason
            and 30-day evidence snapshot remain in the audit trail.
          </Alert>
          <TextField
            autoFocus
            margin="dense"
            label="Reason"
            fullWidth
            multiline
            rows={3}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
            placeholder="Provide a reason for the audit trail"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteUser}
            variant="contained"
            color="error"
            disabled={!deleteReason.trim() || deleteUserMutation.isPending}
          >
            {deleteUserMutation.isPending ? "Deleting…" : "Delete account"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteAllDialogOpen}
        onClose={() => setDeleteAllDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Permanently delete {selectedUserIds.size} selected account
          {selectedUserIds.size === 1 ? "" : "s"}
        </DialogTitle>
        <DialogContent>
          <Alert severity="error" sx={{ mt: 1, mb: 2 }}>
            This permanently removes the selected accounts and their owned
            content. The reason and 30-day evidence snapshots remain in the
            audit trail.
          </Alert>
          <TextField
            autoFocus
            margin="dense"
            label="Reason"
            fullWidth
            multiline
            rows={3}
            value={deleteAllReason}
            onChange={(event) => setDeleteAllReason(event.target.value)}
            placeholder="Provide a reason for the audit trail"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteAllDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteAllUsers}
            variant="contained"
            color="error"
            disabled={!deleteAllReason.trim() || isDeletingSelectedUsers}
          >
            {isDeletingSelectedUsers ? "Deleting…" : "Delete all"}
          </Button>
        </DialogActions>
      </Dialog>

      <LogDetailsDialog
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
      />
    </Container>
  );
};
