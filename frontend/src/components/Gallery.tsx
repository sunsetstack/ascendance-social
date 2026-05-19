import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useParams, useLocation } from "react-router-dom";
import { GalleryProps } from "../types";
import PostCard from "./PostCard";
import MediaCard from "./MediaCard";
import { useAuth } from "../hooks/context/useAuth";
import {
  Box,
  Typography,
  CircularProgress,
  Card,
  Skeleton,
  CardActions,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { telemetry } from "../lib/telemetry";

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
}) => {
  const { t } = useTranslation();

  /**
   * deduplicate posts by publicId while preserving order
   * using Map in to avoid N^2 complexity that .filter or  .findIndex would create
   * this approach uses 'posts ||[]' as a safety fallback defaulting to an empty array
   * if posts is null or undefined
   *
   * .map((p) => [p.publicId, p]) Transforms the array of post objects into an array of tuples.
   * Before: [{ publicId: '123', text: 'hi' }, { publicId: '123', text: 'hi' }]
   * After: [ ['123', { publicId: '123', text: 'hi' }], ['123', { publicId: '123', text: 'hi' }] ]
   *
   * new Map(...) - this forces keys to be unique which results in destroying all duplicates
   * .values() - this extracts just the values (the post objects) after the Map has filtered the data
   * throwing away the isolated publicId keys used for filtering.
   *
   * Array.from(...).values() - the .vlaues() method returns an Iterable Iterator not a real array.
   * Array.from() converts it back into a standard JS array that can be mapped over
   */
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

  // generate a stable feed ID based on current route
  const feedId = `${location.pathname}-${variant}`;

  const isProfileOwner = isLoggedIn && user?.publicId === profileId;
  const postCount = uniquePosts.length;
  // show loading when: explicit loading state OR fetching with no posts to display
  const isLoading = isLoadingAll || (isFetchingAll && postCount === 0);
  const hasPostsToShow = postCount > 0;
  const firstImageIndex = useMemo(
    () => uniquePosts.findIndex((post) => Boolean(post.url || post.image?.url)),
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
      telemetry.trackScrollDepth(feedId, visibleIndex, postCount);
    }
  }, [feedId, postCount, visibleIndex]);

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
            {uniquePosts.map((img, index) => (
              <motion.div
                key={img.publicId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <MediaCard post={img} />
              </motion.div>
            ))}
          </Box>
        ) : (
          uniquePosts.map((img, index) => (
            <TrackedPost
              key={img.publicId}
              index={index}
              onVisible={() =>
                setVisibleIndex((prev) => Math.max(prev, index + 1))
              }
            >
              <PostCard
                post={img}
                prioritizeImage={index === firstImageIndex}
              />
            </TrackedPost>
          ))
        ))}

      {/* Empty State - only show when NOT loading/fetching AND truly no posts */}
      {!isLoading && !isFetchingAll && !hasPostsToShow && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          style={{ width: "100%" }}
        >
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
        </motion.div>
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
          >
            <CircularProgress
              size={32}
              sx={{
                color: "#0ea5e9",
                "& .MuiCircularProgress-circle": {
                  strokeLinecap: "round",
                },
              }}
            />
          </motion.div>
        )}
      </Box>
    </Box>
  );
};

// wrapper component to track when posts become visible
interface TrackedPostProps {
  index: number;
  onVisible: () => void;
  children: React.ReactNode;
}

const TrackedPost: React.FC<TrackedPostProps> = ({
  index,
  onVisible,
  children,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const hasBeenVisible = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasBeenVisible.current) {
          hasBeenVisible.current = true;
          onVisible();
        }
      },
      { threshold: 0.5 },
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [onVisible]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      style={{ width: "100%" }}
    >
      {children}
    </motion.div>
  );
};

export default Gallery;
