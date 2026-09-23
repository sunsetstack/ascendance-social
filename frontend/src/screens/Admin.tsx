import React, { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import type { AuthActivityLog, ClientFingerprint, RequestLog, VisitorObservation } from "../api/adminApi";
import { AdminUserDTO, IPost } from "../types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { useAuth } from "../hooks/context/useAuth";
import { buildAvatarUrl, transformCloudinaryUrl } from "../lib/media";

const MIN_TELEMETRY_SAMPLES = 20;
const ADMIN_TAB_PARAMS = [
  "overview",
  "people",
  "content",
  "experience",
  "requests",
  "security",
] as const;
const LOG_PAGE_SIZES = [25, 50, 100] as const;
const LOG_SEARCH_PARAM_KEYS = [
  "tab",
  "requestPage",
  "requestLimit",
  "requestMethod",
  "requestStatus",
  "requestSearch",
  "requestUserId",
  "requestCorrelationId",
  "requestIp",
  "requestAuthState",
  "requestFrom",
  "requestTo",
  "securityPage",
  "securityLimit",
  "securityAction",
  "securityStatus",
  "securitySearch",
  "securityUserId",
  "securityCorrelationId",
  "securityIp",
  "securityAuthState",
  "securityFrom",
  "securityTo",
] as const;
const AUTH_STATE_OPTIONS = ["anonymous", "auth_failed", "authenticated", "unknown"] as const;
const AUTH_ACTION_OPTIONS = [
  "register",
  "login",
  "refresh",
  "logout",
  "password_reset_requested",
  "password_reset",
  "email_verify",
] as const;

const getLocalDateBoundaryIso = (
  value: string,
  endOfDay = false,
): string | undefined => {
  if (!value) return undefined;
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const date = new Date(`${value}T${time}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const parseStatusCodeFilter = (value: string): number | undefined => {
  const statusCode = Number(value);
  return Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
    ? statusCode
    : undefined;
};

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

const QueryErrorState: React.FC<{
  message: string;
  onRetry: () => void;
}> = ({ message, onRetry }) => (
  <Alert
    severity="error"
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    }
  >
    {message}
  </Alert>
);

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
  log.userId || "Unauthenticated or restricted";

const getPageParam = (value: string | null): number => {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page - 1 : 0;
};

const getLogLimitParam = (value: string | null): number => {
  const limit = Number(value);
  return LOG_PAGE_SIZES.includes(limit as (typeof LOG_PAGE_SIZES)[number])
    ? limit
    : 50;
};

const getAdminTabParam = (value: string | null): number => {
  const tab = ADMIN_TAB_PARAMS.indexOf(
    value as (typeof ADMIN_TAB_PARAMS)[number],
  );
  return tab >= 0 ? tab : 0;
};

const getLogKey = (log: AdminLog, index: number): string =>
  log.correlationId || log.clientRequestId || `${log.timestamp}-${index}`;

const formatLogObject = (value?: ClientFingerprint | VisitorObservation): string | undefined =>
  value ? JSON.stringify(value) : undefined;

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
  onOpenAccount: (publicId: string) => void;
  onOpenCorrelation: (view: "requests" | "security", correlationId: string) => void;
  onOpenIp: (view: "requests" | "security", ip: string) => void;
}> = ({ log, onClose, onOpenAccount, onOpenCorrelation, onOpenIp }) => {
  if (!log) return null;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Request details</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2.5}>
          <Grid item xs={12} sm={6}>
            <DetailValue
              label="Timestamp"
              value={new Date(log.timestamp).toISOString()}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Account public ID" value={log.userId || "Unavailable"} />
          </Grid>
          <Grid item xs={12} sm={6}>
            <DetailValue label="Observed client IP" value={log.ip} />
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
            <DetailValue label="Correlation ID" value={log.correlationId} />
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
          <Grid item xs={12} sm={6}><DetailValue label="Request user-agent" value={log.userAgent} /></Grid>
          <Grid item xs={12} sm={6}><DetailValue label="Request origin" value={log.origin} /></Grid>
          <Grid item xs={12} sm={6}><DetailValue label="Request referrer" value={log.referer} /></Grid>
          <Grid item xs={12} sm={6}><DetailValue label="Fingerprint schema" value={log.clientFingerprintSchemaVersion} /></Grid>
          <Grid item xs={12} sm={6}><DetailValue label="Observed scheme (Express/proxy)" value={log.clientFingerprint?.protocol} /></Grid>
          <Grid item xs={12}><DetailValue label="Request-header fingerprint" value={formatLogObject(log.clientFingerprint)} /></Grid>
          <Grid item xs={12}><DetailValue label="Client-reported visitor observation" value={formatLogObject(log.visitorObservation)} /></Grid>
          <Grid item xs={12} sm={6}><DetailValue label="Request aborted" value={log.aborted} /></Grid>
        </Grid>
        <Alert severity="info" sx={{ mt: 2.5 }}>
          IP, request-header, and client-reported evidence is available only for
          unauthenticated or legacy records. It does not establish account ownership.
        </Alert>
      </DialogContent>
      <DialogActions>
        {log.userId ? (
          <Button onClick={() => onOpenAccount(log.userId!)}>
            View account
          </Button>
        ) : null}
        {log.ip && log.ip !== "[restricted]" ? (
          <>
            <Button onClick={() => onOpenIp("requests", log.ip!)}>Requests from IP</Button>
            <Button onClick={() => onOpenIp("security", log.ip!)}>Security activity from IP</Button>
          </>
        ) : null}
        {log.correlationId ? (
          <>
            <Button onClick={() => onOpenCorrelation("requests", log.correlationId!)}>
              Matching requests
            </Button>
            <Button onClick={() => onOpenCorrelation("security", log.correlationId!)}>
              Matching security activity
            </Button>
          </>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export const AdminDashboard: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const serializedSearchParams = searchParams.toString();
  const applyingUrlState = useRef(false);
  const nextUrlUpdateReplaces = useRef(true);
  const theme = useTheme();
  const { user: currentUser } = useAuth();
  const [currentTab, setCurrentTab] = useState(() =>
    getAdminTabParam(searchParams.get("tab")),
  );
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
  const [logsPage, setLogsPage] = useState(() => getPageParam(searchParams.get("requestPage")));
  const [logsRowsPerPage, setLogsRowsPerPage] = useState(() => getLogLimitParam(searchParams.get("requestLimit")));
  const [logsMethodFilter, setLogsMethodFilter] = useState(() => searchParams.get("requestMethod") || "");
  const [logsStatusInput, setLogsStatusInput] = useState(() => searchParams.get("requestStatus") || "");
  const [logsStatusFilter, setLogsStatusFilter] = useState(() => searchParams.get("requestStatus") || "");
  const [logsSearch, setLogsSearch] = useState(() => searchParams.get("requestSearch") || "");
  const [logsUserId, setLogsUserId] = useState(() => searchParams.get("requestUserId") || "");
  const [logsCorrelationId, setLogsCorrelationId] = useState(() => searchParams.get("requestCorrelationId") || "");
  const [logsIp, setLogsIp] = useState(() => searchParams.get("requestIp") || "");
  const [logsAuthState, setLogsAuthState] = useState(() => searchParams.get("requestAuthState") || "");
  const [logsStartDate, setLogsStartDate] = useState(() => searchParams.get("requestFrom") || "");
  const [logsEndDate, setLogsEndDate] = useState(() => searchParams.get("requestTo") || "");
  const [logsSnapshotAt, setLogsSnapshotAt] = useState(() =>
    new Date().toISOString(),
  );
  const [authLogsPage, setAuthLogsPage] = useState(() => getPageParam(searchParams.get("securityPage")));
  const [authLogsRowsPerPage, setAuthLogsRowsPerPage] = useState(() => getLogLimitParam(searchParams.get("securityLimit")));
  const [authLogsActionFilter, setAuthLogsActionFilter] = useState(() => searchParams.get("securityAction") || "");
  const [authLogsStatusInput, setAuthLogsStatusInput] = useState(() => searchParams.get("securityStatus") || "");
  const [authLogsStatusFilter, setAuthLogsStatusFilter] = useState(() => searchParams.get("securityStatus") || "");
  const [authLogsSearch, setAuthLogsSearch] = useState(() => searchParams.get("securitySearch") || "");
  const [authLogsUserId, setAuthLogsUserId] = useState(() => searchParams.get("securityUserId") || "");
  const [authLogsCorrelationId, setAuthLogsCorrelationId] = useState(() => searchParams.get("securityCorrelationId") || "");
  const [authLogsIp, setAuthLogsIp] = useState(() => searchParams.get("securityIp") || "");
  const [authLogsAuthState, setAuthLogsAuthState] = useState(() => searchParams.get("securityAuthState") || "");
  const [authLogsStartDate, setAuthLogsStartDate] = useState(() => searchParams.get("securityFrom") || "");
  const [authLogsEndDate, setAuthLogsEndDate] = useState(() => searchParams.get("securityTo") || "");
  const [authLogsSnapshotAt, setAuthLogsSnapshotAt] = useState(() =>
    new Date().toISOString(),
  );
  const [selectedLog, setSelectedLog] = useState<AdminLog | null>(null);
  const debouncedUserSearch = useDebouncedValue(userSearch);
  const debouncedLogsSearch = useDebouncedValue(logsSearch);
  const debouncedAuthLogsSearch = useDebouncedValue(authLogsSearch);

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useDashboardStats(currentTab === 0);
  const {
    data: usersData,
    isLoading: usersLoading,
    isError: usersError,
    refetch: refetchUsers,
  } = useAdminUsers(
    {
      page: userPage + 1,
      limit: rowsPerPage,
      search: debouncedUserSearch,
      sortBy,
      sortOrder,
    },
    currentTab === 1,
  );
  const {
    data: imagesData,
    isLoading: imagesLoading,
    isError: imagesError,
    refetch: refetchImages,
  } = useAdminImages(
    { page: imagePage + 1, limit: rowsPerPage },
    currentTab === 2,
  );
  const visibleUsers = usersData?.data ?? [];
  const selectableVisibleUsers = visibleUsers.filter(
    (user) => user.publicId !== currentUser?.publicId,
  );
  const selectedVisibleUserCount = selectableVisibleUsers.reduce(
    (count, user) => count + (selectedUserIds.has(user.publicId) ? 1 : 0),
    0,
  );
  const allVisibleUsersSelected =
    selectableVisibleUsers.length > 0 &&
    selectedVisibleUserCount === selectableVisibleUsers.length;
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
      selectableVisibleUsers.forEach((user) => {
        if (allVisibleUsersSelected) {
          next.delete(user.publicId);
        } else {
          next.add(user.publicId);
        }
      });
      return next;
    });
  };
  const {
    data: activityData,
    isLoading: activityLoading,
    isError: activityError,
    refetch: refetchActivity,
  } = useRecentActivity({ page: 1, limit: 8 }, currentTab === 0);
  const {
    data: telemetryData,
    isLoading: telemetryLoading,
    isError: telemetryError,
    refetch: refetchTelemetry,
  } = useTelemetryMetrics(currentTab === 3);
  const {
    data: requestLogsData,
    isLoading: logsLoading,
    isError: logsError,
    refetch: refetchRequestLogs,
  } = useRequestLogs(
    {
      page: logsPage + 1,
      limit: logsRowsPerPage,
      userId: logsUserId || undefined,
      correlationId: logsCorrelationId || undefined,
      ip: logsIp || undefined,
      authState: logsAuthState || undefined,
      method: logsMethodFilter || undefined,
      statusCode: parseStatusCodeFilter(logsStatusFilter),
      search: debouncedLogsSearch || undefined,
      startDate: getLocalDateBoundaryIso(logsStartDate),
      endDate: getLocalDateBoundaryIso(logsEndDate, true),
      snapshotAt: logsSnapshotAt,
    },
    currentTab === 4,
  );
  const {
    data: authActivityLogsData,
    isLoading: authLogsLoading,
    isError: authLogsError,
    refetch: refetchAuthLogs,
  } = useAuthActivityLogs(
    {
      page: authLogsPage + 1,
      limit: authLogsRowsPerPage,
      userId: authLogsUserId || undefined,
      correlationId: authLogsCorrelationId || undefined,
      ip: authLogsIp || undefined,
      authState: authLogsAuthState || undefined,
      action: authLogsActionFilter || undefined,
      statusCode: parseStatusCodeFilter(authLogsStatusFilter),
      search: debouncedAuthLogsSearch || undefined,
      startDate: getLocalDateBoundaryIso(authLogsStartDate),
      endDate: getLocalDateBoundaryIso(authLogsEndDate, true),
      snapshotAt: authLogsSnapshotAt,
    },
    currentTab === 5,
  );

  const usersTotalPages = usersData?.totalPages;
  const imagesTotalPages = imagesData?.totalPages;

  React.useEffect(() => {
    if (
      usersTotalPages !== undefined &&
      userPage > Math.max(0, usersTotalPages - 1)
    ) {
      setUserPage(Math.max(0, usersTotalPages - 1));
      setSelectedUserIds(new Set());
    }
  }, [userPage, usersTotalPages]);

  React.useEffect(() => {
    if (
      imagesTotalPages !== undefined &&
      imagePage > Math.max(0, imagesTotalPages - 1)
    ) {
      setImagePage(Math.max(0, imagesTotalPages - 1));
    }
  }, [imagePage, imagesTotalPages]);

  React.useEffect(() => {
    const requestLimit = getLogLimitParam(searchParams.get("requestLimit"));
    const securityLimit = getLogLimitParam(searchParams.get("securityLimit"));
    applyingUrlState.current = true;
    setCurrentTab(getAdminTabParam(searchParams.get("tab")));
    setLogsPage(getPageParam(searchParams.get("requestPage")));
    setLogsRowsPerPage(requestLimit);
    setLogsMethodFilter(searchParams.get("requestMethod") || "");
    setLogsStatusInput(searchParams.get("requestStatus") || "");
    setLogsStatusFilter(searchParams.get("requestStatus") || "");
    setLogsSearch(searchParams.get("requestSearch") || "");
    setLogsUserId(searchParams.get("requestUserId") || "");
    setLogsCorrelationId(searchParams.get("requestCorrelationId") || "");
    setLogsIp(searchParams.get("requestIp") || "");
    setLogsAuthState(searchParams.get("requestAuthState") || "");
    setLogsStartDate(searchParams.get("requestFrom") || "");
    setLogsEndDate(searchParams.get("requestTo") || "");
    setAuthLogsPage(getPageParam(searchParams.get("securityPage")));
    setAuthLogsRowsPerPage(securityLimit);
    setAuthLogsActionFilter(searchParams.get("securityAction") || "");
    setAuthLogsStatusInput(searchParams.get("securityStatus") || "");
    setAuthLogsStatusFilter(searchParams.get("securityStatus") || "");
    setAuthLogsSearch(searchParams.get("securitySearch") || "");
    setAuthLogsUserId(searchParams.get("securityUserId") || "");
    setAuthLogsCorrelationId(searchParams.get("securityCorrelationId") || "");
    setAuthLogsIp(searchParams.get("securityIp") || "");
    setAuthLogsAuthState(searchParams.get("securityAuthState") || "");
    setAuthLogsStartDate(searchParams.get("securityFrom") || "");
    setAuthLogsEndDate(searchParams.get("securityTo") || "");

    if (
      (searchParams.has("requestLimit") &&
        searchParams.get("requestLimit") !== String(requestLimit)) ||
      (searchParams.has("securityLimit") &&
        searchParams.get("securityLimit") !== String(securityLimit))
    ) {
      const normalized = new URLSearchParams(searchParams);
      if (normalized.has("requestLimit")) {
        normalized.set("requestLimit", String(requestLimit));
      }
      if (normalized.has("securityLimit")) {
        normalized.set("securityLimit", String(securityLimit));
      }
      setSearchParams(normalized, { replace: true });
    }
  }, [serializedSearchParams]);

  React.useEffect(() => {
    if (applyingUrlState.current) {
      applyingUrlState.current = false;
      return;
    }

    const next = new URLSearchParams(searchParams);
    LOG_SEARCH_PARAM_KEYS.forEach((key) => next.delete(key));
    const set = (key: string, value: string | number, fallback?: string | number): void => {
      if (value !== "" && value !== fallback) next.set(key, String(value));
    };

    next.set("tab", ADMIN_TAB_PARAMS[currentTab]);
    set("requestPage", logsPage + 1, 1);
    set("requestLimit", logsRowsPerPage, 50);
    set("requestMethod", logsMethodFilter);
    set("requestStatus", logsStatusFilter);
    set("requestSearch", logsSearch);
    set("requestUserId", logsUserId);
    set("requestCorrelationId", logsCorrelationId);
    set("requestIp", logsIp);
    set("requestAuthState", logsAuthState);
    set("requestFrom", logsStartDate);
    set("requestTo", logsEndDate);
    set("securityPage", authLogsPage + 1, 1);
    set("securityLimit", authLogsRowsPerPage, 50);
    set("securityAction", authLogsActionFilter);
    set("securityStatus", authLogsStatusFilter);
    set("securitySearch", authLogsSearch);
    set("securityUserId", authLogsUserId);
    set("securityCorrelationId", authLogsCorrelationId);
    set("securityIp", authLogsIp);
    set("securityAuthState", authLogsAuthState);
    set("securityFrom", authLogsStartDate);
    set("securityTo", authLogsEndDate);
    if (next.toString() !== serializedSearchParams) {
      setSearchParams(next, { replace: nextUrlUpdateReplaces.current });
    }
    nextUrlUpdateReplaces.current = true;
  }, [
    authLogsActionFilter,
    authLogsCorrelationId,
    authLogsIp,
    authLogsAuthState,
    authLogsEndDate,
    authLogsPage,
    authLogsRowsPerPage,
    authLogsSearch,
    authLogsStartDate,
    authLogsStatusFilter,
    authLogsUserId,
    currentTab,
    logsCorrelationId,
    logsIp,
    logsAuthState,
    logsEndDate,
    logsMethodFilter,
    logsPage,
    logsRowsPerPage,
    logsSearch,
    logsStartDate,
    logsStatusFilter,
    logsUserId,
    serializedSearchParams,
    setSearchParams,
  ]);

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

  const resetUserSelection = (): void => {
    setSelectedUserIds(new Set());
  };

  const resetLogsQuery = (): void => {
    setLogsPage(0);
    setLogsSnapshotAt(new Date().toISOString());
  };

  const resetAuthLogsQuery = (): void => {
    setAuthLogsPage(0);
    setAuthLogsSnapshotAt(new Date().toISOString());
  };

  const selectTab = (tab: number): void => {
    nextUrlUpdateReplaces.current = false;
    if (tab === 4 && currentTab !== 4) {
      setLogsSnapshotAt(new Date().toISOString());
    }
    if (tab === 5 && currentTab !== 5) {
      setAuthLogsSnapshotAt(new Date().toISOString());
    }
    setCurrentTab(tab);
  };

  const openLogAccount = (publicId: string): void => {
    navigate(`/admin/users/${publicId}`);
  };

  const openCorrelationView = (
    view: "requests" | "security",
    correlationId: string,
  ): void => {
    setSelectedLog(null);
    nextUrlUpdateReplaces.current = false;
    if (view === "requests") {
      setLogsCorrelationId(correlationId);
      setLogsUserId("");
      setLogsIp("");
      setLogsAuthState("");
      setLogsMethodFilter("");
      setLogsStatusInput("");
      setLogsStatusFilter("");
      setLogsSearch("");
      setLogsStartDate("");
      setLogsEndDate("");
      setLogsPage(0);
      setLogsSnapshotAt(new Date().toISOString());
      setCurrentTab(4);
      return;
    }
    setAuthLogsCorrelationId(correlationId);
    setAuthLogsUserId("");
    setAuthLogsIp("");
    setAuthLogsAuthState("");
    setAuthLogsActionFilter("");
    setAuthLogsStatusInput("");
    setAuthLogsStatusFilter("");
    setAuthLogsSearch("");
    setAuthLogsStartDate("");
    setAuthLogsEndDate("");
    setAuthLogsPage(0);
    setAuthLogsSnapshotAt(new Date().toISOString());
    setCurrentTab(5);
  };

  const openIpView = (view: "requests" | "security", ip: string): void => {
    setSelectedLog(null);
    nextUrlUpdateReplaces.current = false;
    if (view === "requests") {
      setLogsIp(ip); setLogsUserId(""); setLogsCorrelationId(""); setLogsAuthState("");
      setLogsMethodFilter(""); setLogsStatusInput(""); setLogsStatusFilter(""); setLogsSearch("");
      setLogsStartDate(""); setLogsEndDate(""); resetLogsQuery(); setCurrentTab(4);
      return;
    }
    setAuthLogsIp(ip); setAuthLogsUserId(""); setAuthLogsCorrelationId(""); setAuthLogsAuthState("");
    setAuthLogsActionFilter(""); setAuthLogsStatusInput(""); setAuthLogsStatusFilter(""); setAuthLogsSearch("");
    setAuthLogsStartDate(""); setAuthLogsEndDate(""); resetAuthLogsQuery(); setCurrentTab(5);
  };

  const handleRefresh = (): void => {
    if (currentTab === 4) {
      setLogsSnapshotAt(new Date().toISOString());
      return;
    }
    if (currentTab === 5) {
      setAuthLogsSnapshotAt(new Date().toISOString());
      return;
    }
    if (currentTab === 1) {
      resetUserSelection();
    }
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
    const publicId = selectedUser.publicId;
    deleteUserMutation.mutate(
      { publicId, reason: deleteReason.trim() },
      {
        onSuccess: () => {
          setSelectedUserIds((current) => {
            const next = new Set(current);
            next.delete(publicId);
            return next;
          });
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
        onChange={(_, newValue) => selectTab(newValue)}
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
        {statsError ? (
          <QueryErrorState
            message="Unable to load the admin overview."
            onRetry={() => void refetchStats()}
          />
        ) : statsLoading ? (
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
                  <Button size="small" onClick={() => selectTab(4)}>
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
                    onClick={() => selectTab(1)}
                  >
                    Review people
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<ArticleIcon />}
                    onClick={() => selectTab(2)}
                  >
                    Review posts
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<SecurityIcon />}
                    onClick={() => selectTab(5)}
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
                      onClick={() => {
                        if (
                          window.confirm(
                            "Clear the feed cache now? This may temporarily increase feed load.",
                          )
                        ) {
                          clearCacheMutation.mutate("feed:*");
                        }
                      }}
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
                  {activityLoading ? (
                    <Box
                      sx={{ display: "grid", placeItems: "center", minHeight: 120 }}
                    >
                      <CircularProgress size={24} />
                    </Box>
                  ) : activityError ? (
                    <QueryErrorState
                      message="Unable to load recent activity."
                      onRetry={() => void refetchActivity()}
                    />
                  ) : activityData?.data.length ? (
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
                  resetUserSelection();
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
                  resetUserSelection();
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
                  resetUserSelection();
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
                  resetUserSelection();
                }}
              >
                Reset
              </Button>
            </Stack>
          </Panel>

          {usersError ? (
            <QueryErrorState
              message="Unable to load accounts."
              onRetry={() => void refetchUsers()}
            />
          ) : usersLoading ? (
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
                    {visibleUsers.length ? (
                      visibleUsers.map((user) => (
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
                            disabled={user.publicId === currentUser?.publicId}
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
                              <Tooltip title="Re-enable account access (content remains removed)">
                                <IconButton
                                  aria-label="Re-enable account access"
                                  size="small"
                                  color="success"
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Re-enable ${user.username}'s account? Content removed during the ban is not restored.`,
                                      )
                                    ) {
                                      unbanUserMutation.mutate(user.publicId);
                                    }
                                  }}
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
                                  disabled={user.publicId === currentUser?.publicId}
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
                                  disabled={user.publicId === currentUser?.publicId}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Remove administrator access from ${user.username}?`,
                                      )
                                    ) {
                                      demoteUserMutation.mutate(user.publicId);
                                    }
                                  }}
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
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        `Grant administrator access to ${user.username}?`,
                                      )
                                    ) {
                                      promoteUserMutation.mutate(user.publicId);
                                    }
                                  }}
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
                                disabled={user.publicId === currentUser?.publicId}
                                onClick={() => openDeleteDialog(user)}
                              >
                                <DeleteIcon />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        </TableCell>
                      </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography
                            color="text.secondary"
                            sx={{ py: 4, textAlign: "center" }}
                          >
                            No accounts match these filters.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={usersData?.total ?? 0}
                page={userPage}
                onPageChange={(_, page) => {
                  setUserPage(page);
                  resetUserSelection();
                }}
                rowsPerPage={rowsPerPage}
                onRowsPerPageChange={(event) => {
                  setRowsPerPage(parseInt(event.target.value, 10));
                  setUserPage(0);
                  resetUserSelection();
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
          {imagesError ? (
            <QueryErrorState
              message="Unable to load posts."
              onRetry={() => void refetchImages()}
            />
          ) : imagesLoading ? (
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
                    {imagesData?.data.length ? (
                      imagesData.data.map((post: IPost) => {
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
                      })
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <Typography
                            color="text.secondary"
                            sx={{ py: 4, textAlign: "center" }}
                          >
                            No posts are available.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
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
        {telemetryError ? (
          <QueryErrorState
            message="Unable to load experience telemetry."
            onRetry={() => void refetchTelemetry()}
          />
        ) : telemetryLoading ? (
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
            description="Filter by route, outcome, public account ID, or correlation ID. Restricted evidence is unavailable here."
          >
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.25}
              sx={{ p: 2 }}
            >
              <TextField
                size="small"
                label="Search requests"
                placeholder="Route or safe diagnostic ID"
                value={logsSearch}
                onChange={(event) => {
                  setLogsSearch(event.target.value);
                  resetLogsQuery();
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
                  resetLogsQuery();
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
                <option value="HEAD">HEAD</option>
                <option value="OPTIONS">OPTIONS</option>
              </TextField>
              <TextField
                type="number"
                size="small"
                label="Status"
                value={logsStatusInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setLogsStatusInput(value);
                  if (value === "" || parseStatusCodeFilter(value)) {
                    setLogsStatusFilter(value);
                    resetLogsQuery();
                  }
                }}
                inputProps={{ min: 100, max: 599 }}
                sx={{ minWidth: 130 }}
              />
              <TextField
                size="small"
                label="Account public ID"
                value={logsUserId}
                onChange={(event) => {
                  setLogsUserId(event.target.value);
                  resetLogsQuery();
                }}
                sx={{ minWidth: 190 }}
              />
              <TextField
                size="small"
                label="Correlation ID"
                value={logsCorrelationId}
                onChange={(event) => {
                  setLogsCorrelationId(event.target.value);
                  resetLogsQuery();
                }}
                sx={{ minWidth: 190 }}
              />
              <TextField size="small" label="Observed IP" value={logsIp} onChange={(event) => { setLogsIp(event.target.value); resetLogsQuery(); }} sx={{ minWidth: 160 }} />
              <TextField select size="small" label="Auth state" value={logsAuthState} onChange={(event) => { setLogsAuthState(event.target.value); resetLogsQuery(); }} SelectProps={{ native: true }} sx={{ minWidth: 150 }}>
                <option value="">All states</option>
                {AUTH_STATE_OPTIONS.map((state) => <option key={state} value={state}>{state}</option>)}
              </TextField>
              <TextField
                type="date"
                size="small"
                label="From"
                value={logsStartDate}
                onChange={(event) => {
                  setLogsStartDate(event.target.value);
                  resetLogsQuery();
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
                  resetLogsQuery();
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
            {logsError ? (
              <QueryErrorState
                message="Unable to load request traces."
                onRetry={() => void refetchRequestLogs()}
              />
            ) : logsLoading ? (
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
                        <TableCell>Account</TableCell>
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
            description="Authentication outcomes linked by public account ID or correlation ID. Restricted evidence is unavailable here."
          >
            <Stack
              direction={{ xs: "column", lg: "row" }}
              spacing={1.25}
              sx={{ p: 2 }}
            >
              <TextField
                size="small"
                label="Search security activity"
                placeholder="Event, route, or safe diagnostic ID"
                value={authLogsSearch}
                onChange={(event) => {
                  setAuthLogsSearch(event.target.value);
                  resetAuthLogsQuery();
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
                label="Event"
                value={authLogsActionFilter}
                onChange={(event) => {
                  setAuthLogsActionFilter(event.target.value);
                  resetAuthLogsQuery();
                }}
                SelectProps={{ native: true }}
                sx={{ minWidth: 150 }}
              >
                <option value="">All events</option>
                {AUTH_ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action.replace(/_/g, " ")}
                  </option>
                ))}
              </TextField>
              <TextField
                type="number"
                size="small"
                label="Status"
                value={authLogsStatusInput}
                onChange={(event) => {
                  const value = event.target.value;
                  setAuthLogsStatusInput(value);
                  if (value === "" || parseStatusCodeFilter(value)) {
                    setAuthLogsStatusFilter(value);
                    resetAuthLogsQuery();
                  }
                }}
                inputProps={{ min: 100, max: 599 }}
                sx={{ minWidth: 125 }}
              />
              <TextField
                size="small"
                label="Account public ID"
                value={authLogsUserId}
                onChange={(event) => {
                  setAuthLogsUserId(event.target.value);
                  resetAuthLogsQuery();
                }}
                sx={{ minWidth: 190 }}
              />
              <TextField
                size="small"
                label="Correlation ID"
                value={authLogsCorrelationId}
                onChange={(event) => {
                  setAuthLogsCorrelationId(event.target.value);
                  resetAuthLogsQuery();
                }}
                sx={{ minWidth: 190 }}
              />
              <TextField size="small" label="Observed IP" value={authLogsIp} onChange={(event) => { setAuthLogsIp(event.target.value); resetAuthLogsQuery(); }} sx={{ minWidth: 160 }} />
              <TextField select size="small" label="Auth state" value={authLogsAuthState} onChange={(event) => { setAuthLogsAuthState(event.target.value); resetAuthLogsQuery(); }} SelectProps={{ native: true }} sx={{ minWidth: 150 }}>
                <option value="">All states</option>
                {AUTH_STATE_OPTIONS.map((state) => <option key={state} value={state}>{state}</option>)}
              </TextField>
              <TextField
                type="date"
                size="small"
                label="From"
                value={authLogsStartDate}
                onChange={(event) => {
                  setAuthLogsStartDate(event.target.value);
                  resetAuthLogsQuery();
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
                  resetAuthLogsQuery();
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
            {authLogsError ? (
              <QueryErrorState
                message="Unable to load security activity."
                onRetry={() => void refetchAuthLogs()}
              />
            ) : authLogsLoading ? (
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
                        <TableCell>Account</TableCell>
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
        onOpenAccount={openLogAccount}
        onOpenCorrelation={openCorrelationView}
        onOpenIp={openIpView}
      />
    </Container>
  );
};
