import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useLocation } from "react-router-dom";
import { GalleryProps } from "../types";
import PostCard from "./PostCard";
import MediaCard from "./MediaCard";
import { useAuth } from "../hooks/context/useAuth";
import {
  Alert,
  Box,
  Button,
  Typography,
  CircularProgress,
  Card,
  Skeleton,
  CardActions,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { telemetry } from "../lib/telemetry";
import {
  feedRestorationStore,
  formatNewPostsLabel,
  useFeedPending,
  useIsFeedRestoreNavigation,
} from "../features/feed/feedRestoration";

const Gallery: React.FC<GalleryProps> = ({
  posts,
  fetchNextPage,
  hasNextPage,
  isFetchingNext,
  isLoadingAll,
  isFetchingAll,
  emptyTitle,
  emptyDescription,
  variant = "feed",
  feedId,
  onRefresh,
}) => {
  const { t } = useTranslation();

  // Deduplicate by publicId without changing the first-seen feed order.
  const uniquePosts = useMemo(
    () =>
      Array.from(new Map((posts || []).map((p) => [p.publicId, p])).values()),
    [posts],
  );

  const { user, isLoggedIn } = useAuth();
  const { id: profileId } = useParams<{ id: string }>();
  const location = useLocation();

  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [visibleIndex, setVisibleIndex] = useState(0);

  const handlePostVisible = useCallback((index: number) => {
    setVisibleIndex((previous) => Math.max(previous, index + 1));
  }, []);

  const telemetryFeedId = `${location.pathname}-${variant}`;
  const restorationEnabled = Boolean(feedId && onRefresh);
  const isRestoring = useIsFeedRestoreNavigation(feedId ?? "");
  const hasRestorationTarget = Boolean(
    restorationEnabled &&
      feedId &&
      feedRestorationStore.isRestorationFor(feedId, location.key),
  );
  const pending = useFeedPending(feedId, location.key);
  const pendingLabel = formatNewPostsLabel(pending);
  const anchorRefs = useRef(new Map<string, HTMLDivElement>());
  const activeFeedKey = restorationEnabled && feedId
    ? `${feedId}\u0000${location.key}`
    : null;
  const activeFeedKeyRef = useRef(activeFeedKey);
  const [refreshingFeedKey, setRefreshingFeedKey] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<{
    feedKey: string;
    message: string;
  } | null>(null);
  const isRefreshing = Boolean(
    activeFeedKey && refreshingFeedKey === activeFeedKey,
  );
  const visibleRefreshError =
    refreshError?.feedKey === activeFeedKey ? refreshError.message : null;

  useLayoutEffect(() => {
    activeFeedKeyRef.current = activeFeedKey;
    return () => {
      activeFeedKeyRef.current = null;
    };
  }, [activeFeedKey]);

  const isProfileOwner = isLoggedIn && user?.publicId === profileId;
  const postCount = uniquePosts.length;
  // show loading when: explicit loading state OR fetching with no posts to display
  const isLoading = isLoadingAll || (isFetchingAll && postCount === 0);
  const hasPostsToShow = postCount > 0;
  const prioritizedImageIndices = useMemo(
    () =>
      new Set(
        uniquePosts
          .map((post, index) =>
            post.url || post.image?.url ? index : -1,
          )
          .filter((index) => index >= 0)
          .slice(0, 2),
      ),
    [uniquePosts],
  );
  // show skeleton only when loading/fetching - never show empty state while loading
  const showSkeleton = isLoading && !hasPostsToShow;
  const fallbackEmptyTitle = t("profile.no_posts");
  const fallbackEmptyMessage = isProfileOwner
    ? t("profile.no_posts_description")
    : t("profile.no_posts_other");
  const resolvedEmptyTitle = emptyTitle ?? fallbackEmptyTitle;
  const resolvedEmptyMessage = emptyDescription ?? fallbackEmptyMessage;

  // track scroll depth
  useEffect(() => {
    if (postCount > 0) {
      telemetry.trackScrollDepth(telemetryFeedId, visibleIndex, postCount);
    }
  }, [telemetryFeedId, postCount, visibleIndex]);

  const handlePostOpen = useCallback(
    (postPublicId: string) => {
      if (!restorationEnabled || !feedId) return;
      const anchor = anchorRefs.current.get(postPublicId);
      if (!anchor) return;
      feedRestorationStore.captureAnchor({
        feedId,
        postId: postPublicId,
        top: anchor.getBoundingClientRect().top,
        sourceLocationKey: location.key,
      });
    },
    [feedId, location.key, restorationEnabled],
  );

  useLayoutEffect(() => {
    if (!restorationEnabled || !feedId) return;
    return feedRestorationStore.registerSession(feedId, location.key);
  }, [feedId, location.key, restorationEnabled]);

  useLayoutEffect(() => {
    if (!restorationEnabled || !feedId || !isRestoring) return;
    const restoration = feedRestorationStore.getRestoration(feedId, location.key);
    if (!restoration) return;

    const isLoading = Boolean(isLoadingAll || isFetchingAll);
    if (isLoading) return;

    const anchor = anchorRefs.current.get(restoration.postId);
    if (!anchor) {
      feedRestorationStore.consumeRestoration(feedId, location.key);
      return;
    }

    const delta = anchor.getBoundingClientRect().top - restoration.top;
    if (typeof window !== "undefined") {
      window.scrollBy({ top: delta, behavior: "auto" });
    }
    feedRestorationStore.consumeRestoration(feedId, location.key);
  }, [
    feedId,
    isFetchingAll,
    isLoadingAll,
    isRestoring,
    location.key,
    restorationEnabled,
    uniquePosts,
  ]);

  const handleRefresh = useCallback(async () => {
    if (
      !restorationEnabled ||
      !feedId ||
      !onRefresh ||
      !activeFeedKey ||
      isRefreshing
    ) {
      return;
    }
    const refreshFeedKey = activeFeedKey;
    setRefreshingFeedKey(refreshFeedKey);
    setRefreshError(null);
    const pendingVersion = feedRestorationStore.getPendingVersion(
      feedId,
      location.key,
    );
    try {
      await onRefresh();
      if (activeFeedKeyRef.current !== refreshFeedKey) return;
      feedRestorationStore.clearPending(feedId, location.key, pendingVersion);
      feedRestorationStore.consumeRestoration(feedId, location.key);
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "auto" });
      }
    } catch (error) {
      if (activeFeedKeyRef.current === refreshFeedKey) {
        setRefreshError({
          feedKey: refreshFeedKey,
          message:
            error instanceof Error && error.message
              ? error.message
              : "Unable to refresh feed.",
        });
      }
    } finally {
      setRefreshingFeedKey((current) =>
        current === refreshFeedKey ? null : current,
      );
    }
  }, [
    activeFeedKey,
    feedId,
    isRefreshing,
    location.key,
    onRefresh,
    restorationEnabled,
  ]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const firstEntry = entries[0];
        if (firstEntry.isIntersecting && hasNextPage && !isFetchingNext) {
          fetchNextPage();
        }
      },
      { root: null, rootMargin: "100px", threshold: 0.1 },
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) observer.observe(currentRef);
    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNext, fetchNextPage]);

  const renderSkeletons = () => {
    if (variant === "media") {
      return (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 0.5,
            width: "100%",
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton
              key={i}
              variant="rectangular"
              sx={{ paddingTop: "100%" }}
            />
          ))}
        </Box>
      );
    }
    return Array.from({ length: 3 }).map((_, i) => (
      <Card
        key={i}
        sx={{
          width: "100%",
          borderBottom: "1px solid rgba(99, 102, 241, 0.1)",
          borderRadius: 0,
          boxShadow: "none",
        }}
      >
        <Skeleton
          variant="rectangular"
          height={400}
          sx={{ bgcolor: "rgba(99, 102, 241, 0.1)" }}
        />
        <CardActions sx={{ p: 2 }}>
          <Skeleton variant="text" width="60%" height={24} />
          <Skeleton
            variant="circular"
            width={40}
            height={40}
            sx={{ ml: "auto" }}
          />
        </CardActions>
      </Card>
    ));
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "100%",
        p: 0,
      }}
    >
      {restorationEnabled && (pending.hasPending || visibleRefreshError) && (
        <Box
          sx={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: {
              xs: "calc(72px + env(safe-area-inset-bottom))",
              sm: 2,
            },
            zIndex: 1100,
            display: "flex",
            justifyContent: "center",
            px: 1,
            pointerEvents: "none",
          }}
        >
          <Box
            sx={{
              width: "min(420px, calc(100vw - 16px))",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 0.5,
              pointerEvents: "auto",
            }}
          >
            {pending.hasPending && (
              <Button
                data-feed-new-posts
                size="small"
                variant="contained"
                onClick={() => void handleRefresh()}
                disabled={isRefreshing}
                aria-label={pendingLabel}
                sx={{ borderRadius: 999, px: 2, py: 0.5 }}
              >
                {pendingLabel}
              </Button>
            )}

            {visibleRefreshError && (
              <Alert
                role="alert"
                severity="error"
                onClose={() => setRefreshError(null)}
                sx={{ width: "100%", py: 0.25 }}
              >
                {visibleRefreshError}
              </Alert>
            )}
          </Box>
        </Box>
      )}

      {/* Loading Skeletons - show while loading and no posts yet */}
      {showSkeleton && renderSkeletons()}

      {/* Post Cards with motion */}
      {hasPostsToShow &&
        (variant === "media" ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 0.5,
              width: "100%",
            }}
          >
            {uniquePosts.map((img) => (
              <div
                key={img.publicId}
                ref={(element) => {
                  if (element) anchorRefs.current.set(img.publicId, element);
                  else anchorRefs.current.delete(img.publicId);
                }}
              >
                <MediaCard
                  post={img}
                  onOpen={restorationEnabled ? handlePostOpen : undefined}
                />
              </div>
            ))}
          </Box>
        ) : (
          uniquePosts.map((img, index) => (
            <TrackedPost
              key={img.publicId}
              index={index}
              onVisible={handlePostVisible}
              forceRealLayout={hasRestorationTarget}
              anchorRef={(element) => {
                if (element) anchorRefs.current.set(img.publicId, element);
                else anchorRefs.current.delete(img.publicId);
              }}
            >
              <PostCard
                post={img}
                prioritizeImage={prioritizedImageIndices.has(index)}
                onOpen={restorationEnabled ? handlePostOpen : undefined}
              />
            </TrackedPost>
          ))
        ))}

      {/* Empty State - only show when NOT loading/fetching AND truly no posts */}
      {!isLoading && !isFetchingAll && !hasPostsToShow && (
        <Box sx={{ width: "100%" }}>
          <Box
            sx={{
              textAlign: "center",
              py: 8,
              px: 4,
              border: "1px solid rgba(99, 102, 241, 0.2)",
              borderRadius: 3,
              minWidth: "300px",
              mx: "auto",
              mt: 4,
              maxWidth: "600px",
            }}
          >
            <Typography
              variant="h6"
              sx={{
                mb: 2,
                background: "linear-gradient(45deg, #f8fafc, #cbd5e1)",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "text.primary",
                fontWeight: 600,
              }}
            >
              {resolvedEmptyTitle}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {resolvedEmptyMessage}
            </Typography>
          </Box>
        </Box>
      )}

      {/* Infinite Scroll Trigger */}
      <Box
        ref={loadMoreRef}
        sx={{
          height: 80,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          mt: 2,
        }}
      >
        {isFetchingNext && (
          <Box>
            <CircularProgress
              size={32}
              sx={{
                color: "#0ea5e9",
                "& .MuiCircularProgress-circle": {
                  strokeLinecap: "round",
                },
              }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
};

// wrapper component to track when posts become visible
interface TrackedPostProps {
  index: number;
  onVisible: (index: number) => void;
  anchorRef: (element: HTMLDivElement | null) => void;
  forceRealLayout: boolean;
  children: React.ReactNode;
}

const TrackedPost: React.FC<TrackedPostProps> = ({
  index,
  onVisible,
  anchorRef,
  forceRealLayout,
  children,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const hasBeenVisible = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasBeenVisible.current) {
          hasBeenVisible.current = true;
          onVisible(index);
        }
      },
      { threshold: 0.5 },
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index, onVisible]);

  return (
    <div
      ref={(element) => {
        ref.current = element;
        anchorRef(element);
      }}
      style={{
        width: "100%",
        ...(forceRealLayout
          ? { contentVisibility: "visible" }
          : {
              contentVisibility: "auto",
              containIntrinsicSize: "auto 700px",
            }),
      }}
    >
      {children}
    </div>
  );
};

export default Gallery;
