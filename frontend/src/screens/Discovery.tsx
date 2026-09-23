import React, { useState, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Box,
  Typography,
  Tabs,
  Tab,
  useTheme,
  alpha,
  IconButton,
  Tooltip,
  useMediaQuery,
  Alert,
  Button,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";

import Gallery from "../components/Gallery";
import { useAuth } from "../hooks/context/useAuth";
import {
  useTrendingFeed,
  useNewFeed,
  useForYouFeed,
} from "../hooks/posts/usePosts";
import { PageSeo } from "../lib/PageSeo";
import { buildDiscoveryMetadata } from "../lib/seo";
import { feedIdentities } from "../features/feed/feedIdentity";
import { feedRestorationStore } from "../features/feed/feedRestoration";

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

interface FeedLoadErrorProps {
  onRetry: () => void;
}

const FeedLoadError: React.FC<FeedLoadErrorProps> = ({ onRetry }) => (
  <Alert
    severity="error"
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    }
    sx={{ mx: 2, my: 2 }}
  >
    Unable to load this feed.
  </Alert>
);

const TabPanel: React.FC<TabPanelProps> = ({
  children,
  value,
  index,
  ...other
}) => {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`discovery-tabpanel-${index}`}
      aria-labelledby={`discovery-tab-${index}`}
      {...other}
    >
      {value === index && <Box>{children}</Box>}
    </div>
  );
};

// map feed names to tab indices
const feedToIndex: Record<string, number> = {
  latest: 0,
  new: 0,
  trending: 1,
  foryou: 2,
  following: 0, // fallback to new/latest for now
};

const Discovery: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isLoggedIn, loading: authLoading, user } = useAuth();

  // check if we have a specific feed requested via URL param
  const requestedFeed = searchParams.get("feed");
  const historyFeed = (location.state as { discoveryFeed?: string } | null)
    ?.discoveryFeed;
  const selectedFeed = requestedFeed ?? historyFeed;
  const displayedFeed =
    !isLoggedIn && selectedFeed === "foryou" ? "latest" : selectedFeed;
  const isSingleFeedMode = isMobile && !!requestedFeed;
  const activeTab = displayedFeed ? (feedToIndex[displayedFeed] ?? 0) : 0;

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const currentLocationKeyRef = React.useRef<string | null>(location.key);

  React.useLayoutEffect(() => {
    currentLocationKeyRef.current = location.key;
    return () => {
      currentLocationKeyRef.current = null;
    };
  }, [location.key]);

  // Normalize anonymous For You deep links to Latest.
  useEffect(() => {
    if (authLoading) return;

    if (!isLoggedIn && requestedFeed === "foryou") {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("feed", "latest");
          return next;
        },
        { replace: true },
      );
    }
  }, [authLoading, isLoggedIn, requestedFeed, setSearchParams]);

  const trendingFeedQuery = useTrendingFeed({ enabled: activeTab === 1 });
  const newFeedQuery = useNewFeed({ enabled: activeTab === 0 });
  const forYouFeedQuery = useForYouFeed({
    enabled: isLoggedIn && activeTab === 2,
  });
  const latestFeedId = feedIdentities.latest(user?.publicId);
  const trendingFeedId = feedIdentities.trending(user?.publicId);
  const forYouFeedId = feedIdentities.forYou(user?.publicId);
  const newPosts =
    newFeedQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const trendingPosts =
    trendingFeedQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const forYouPosts =
    forYouFeedQuery.data?.pages.flatMap((page) => page.data) ?? [];

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    if (newValue !== activeTab) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    const feed = ["latest", "trending", "foryou"][newValue];
    if (!feed) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (requestedFeed) next.set("feed", feed);
        return next;
      },
      {
        replace: true,
        state: {
          ...(location.state && typeof location.state === "object"
            ? location.state
            : {}),
          discoveryFeed: feed,
        },
      },
    );
  };

  const handleRefreshNewFeed = async () => {
    if (!isLoggedIn || isRefreshing) return;
    const refreshLocationKey = location.key;
    setIsRefreshing(true);
    setRefreshError(null);
    const pendingVersion = feedRestorationStore.getPendingVersion(
      latestFeedId,
      refreshLocationKey,
    );
    try {
      await newFeedQuery.refreshFeed();
      if (currentLocationKeyRef.current !== refreshLocationKey) return;
      feedRestorationStore.clearPending(
        latestFeedId,
        refreshLocationKey,
        pendingVersion,
      );
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {
      if (currentLocationKeyRef.current === refreshLocationKey) {
        setRefreshError("Unable to refresh the latest feed.");
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  // get feed title for single feed mode
  const getFeedTitle = () => {
    switch (displayedFeed) {
      case "trending":
        return "Trending";
      case "latest":
      case "new":
        return "Latest";
      case "foryou":
        return "For You";
      case "following":
        return "Following";
      default:
        return "Explore";
    }
  };

  // Show loading during auth transitions
  if (authLoading) {
    return (
      <>
        <PageSeo {...buildDiscoveryMetadata({ feed: displayedFeed })} />
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "50vh",
          }}
        >
          <Typography>Loading...</Typography>
        </Box>
      </>
    );
  }

  return (
    <>
      <PageSeo {...buildDiscoveryMetadata({ feed: displayedFeed })} />
      <Box
        sx={{
          display: "flex",
          flexGrow: 1,
          width: "100%",
          minWidth: 0,
          height: "auto",
          overflow: "visible",
        }}
      >
        {/* Main Content */}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            width: "100%",
            minWidth: 0,
            p: 0,
            overflow: "visible",
            height: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Single feed mode header (mobile only) */}
          {isSingleFeedMode && (
            <Box
              sx={{
                width: "100%",
                py: 1.5,
                px: 2,
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="h6" fontWeight={700}>
                {getFeedTitle()}
              </Typography>
              {activeTab === 0 && isLoggedIn && (
                <Tooltip title="Refresh for latest posts">
                    <IconButton
                      onClick={handleRefreshNewFeed}
                      disabled={isRefreshing}
                      size="small"
                      aria-label="Refresh latest posts"
                      sx={{
                      animation: isRefreshing
                        ? "spin 1s linear infinite"
                        : "none",
                      "@keyframes spin": {
                        "0%": { transform: "rotate(0deg)" },
                        "100%": { transform: "rotate(360deg)" },
                      },
                    }}
                  >
                    <RefreshIcon />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )}

          {/* Tabs - hidden in single feed mode on mobile */}
          {!isSingleFeedMode && (
            <Box
              sx={{
                width: "100%",
                borderBottom: 1,
                borderColor: "divider",
                position: "sticky",
                top: isMobile ? 48 : 0,
                zIndex: (theme) => theme.zIndex.appBar - 1,
                flexShrink: 0,
                bgcolor: "background.default",
              }}
            >
              <Tabs
                value={activeTab}
                onChange={handleTabChange}
                aria-label="discovery feed tabs"
                variant="fullWidth"
                sx={{
                  "& .MuiTabs-indicator": {
                    height: 4,
                    borderRadius: 2,
                    bgcolor: "primary.main",
                  },
                  "& .MuiTab-root": {
                    textTransform: "none",
                    fontSize: "1rem",
                    fontWeight: 700,
                    minWidth: 0,
                    flex: 1,
                    px: 1,
                    minHeight: 53,
                    color: "text.secondary",
                    "&.Mui-selected": {
                      color: "text.primary",
                    },
                    "&:hover": {
                      backgroundColor: alpha(theme.palette.text.primary, 0.1),
                    },
                  },
                }}
              >
                <Tab
                  label="Latest"
                  id="discovery-tab-0"
                  aria-controls="discovery-tabpanel-0"
                />
                <Tab
                  label="Trending"
                  id="discovery-tab-1"
                  aria-controls="discovery-tabpanel-1"
                />
                {isLoggedIn && (
                  <Tab
                    label="For You"
                    id="discovery-tab-2"
                    aria-controls="discovery-tabpanel-2"
                  />
                )}
              </Tabs>
            </Box>
          )}

          <Box sx={{ width: "100%" }}>
            {/* Tab Panels */}
            <TabPanel value={activeTab} index={0}>
              <Box>
                {!isSingleFeedMode && isLoggedIn && (
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "flex-end",
                      px: 2,
                      py: 1,
                    }}
                  >
                    <Tooltip title="Refresh for latest posts">
                      <IconButton
                        onClick={handleRefreshNewFeed}
                        disabled={isRefreshing}
                        size="small"
                        aria-label="Refresh latest posts"
                        sx={{
                          animation: isRefreshing
                            ? "spin 1s linear infinite"
                            : "none",
                          "@keyframes spin": {
                            "0%": { transform: "rotate(0deg)" },
                            "100%": { transform: "rotate(360deg)" },
                          },
                        }}
                      >
                        <RefreshIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                )}
                {refreshError && !newFeedQuery.isError && (
                  <Alert
                    severity="error"
                    onClose={() => setRefreshError(null)}
                    sx={{ mx: 2, my: 2 }}
                  >
                    {refreshError}
                  </Alert>
                )}
                {newFeedQuery.isError && (
                  <FeedLoadError
                    onRetry={() => void newFeedQuery.refetch()}
                  />
                )}
                {(!newFeedQuery.isError || newPosts.length > 0) && (
                  <Gallery
                    posts={newPosts}
                    fetchNextPage={newFeedQuery.fetchNextPage}
                    hasNextPage={!!newFeedQuery.hasNextPage}
                    isFetchingNext={newFeedQuery.isFetchingNextPage}
                    isLoadingAll={
                      newFeedQuery.isLoading || newFeedQuery.isPending
                    }
                    isFetchingAll={newFeedQuery.isFetching}
                    feedId={latestFeedId}
                    onRefresh={newFeedQuery.refreshFeed}
                  />
                )}
              </Box>
            </TabPanel>

            <TabPanel value={activeTab} index={1}>
              <Box>
                {trendingFeedQuery.isError && (
                  <FeedLoadError
                    onRetry={() => void trendingFeedQuery.refetch()}
                  />
                )}
                {(!trendingFeedQuery.isError ||
                  trendingPosts.length > 0) && (
                  <Gallery
                    posts={trendingPosts}
                    fetchNextPage={trendingFeedQuery.fetchNextPage}
                    hasNextPage={!!trendingFeedQuery.hasNextPage}
                    isFetchingNext={trendingFeedQuery.isFetchingNextPage}
                    isLoadingAll={
                      trendingFeedQuery.isLoading ||
                      trendingFeedQuery.isPending
                    }
                    isFetchingAll={trendingFeedQuery.isFetching}
                    feedId={trendingFeedId}
                    onRefresh={trendingFeedQuery.refreshFeed}
                  />
                )}
              </Box>
            </TabPanel>

            {isLoggedIn && (
              <TabPanel value={activeTab} index={2}>
                <Box>
                  {forYouFeedQuery.isError && (
                    <FeedLoadError
                      onRetry={() => void forYouFeedQuery.refetch()}
                    />
                  )}
                  {(!forYouFeedQuery.isError || forYouPosts.length > 0) && (
                    <Gallery
                      posts={forYouPosts}
                      fetchNextPage={forYouFeedQuery.fetchNextPage}
                      hasNextPage={!!forYouFeedQuery.hasNextPage}
                      isFetchingNext={forYouFeedQuery.isFetchingNextPage}
                      isLoadingAll={
                        forYouFeedQuery.isLoading || forYouFeedQuery.isPending
                      }
                      isFetchingAll={forYouFeedQuery.isFetching}
                      feedId={forYouFeedId}
                      onRefresh={forYouFeedQuery.refreshFeed}
                    />
                  )}
                </Box>
              </TabPanel>
            )}
          </Box>

          {/* Empty State */}
          {!isLoggedIn && (
            <Box sx={{ textAlign: "center", py: 6, px: 2 }}>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
                Sign in to see your personalized "For You" feed based on your
                interests and interactions.
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </>
  );
};

export default Discovery;
