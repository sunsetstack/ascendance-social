import { useState } from "react";
import { Alert, Avatar, Box, Button, ButtonBase, Skeleton, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { feedApi } from "../api/feedApi";
import axiosClient from "../api/axiosClient";
import type { FeedPreviewPage } from "../api/postApi";
import { useAuth } from "../hooks/context/useAuth";
import { buildAvatarUrl } from "../lib/media";
import { mapPost } from "../lib/mappers";

export default function TrendingTags() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const trends = useQuery({
    queryKey: ["trending-tags", 3, 24],
    queryFn: () => feedApi.getTrendingTags(3, 24),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
  const tags = trends.data?.tags ?? [];
  const activeTag = tags.find(({ tag }) => tag === selectedTag)?.tag ?? tags[0]?.tag;
  const posts = useQuery({
    queryKey: ["hotTopicPosts", activeTag, user?.publicId ?? "guest"],
    queryFn: async ({ signal }) => {
      const { data } = await axiosClient.get<FeedPreviewPage>("/api/feed/preview", {
        params: { topics: activeTag, sort: "relevant", includeReposts: "false", limit: 3 }, signal,
      });
      return { ...data, data: data.data.map(mapPost) };
    },
    enabled: !loading && !!activeTag,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  return (
    <Box component="section" aria-labelledby="hot-topics-title">
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <Typography component="h2" variant="h6" id="hot-topics-title" sx={{ fontWeight: 800 }}>{t("hot_topics.title")}</Typography>
        <Typography variant="caption" color="text.secondary">{t("hot_topics.subtitle")}</Typography>
      </Box>
      {trends.isPending ? <Box sx={{ px: 2, pb: 2 }}><Skeleton height={55} /><Skeleton height={55} /><Skeleton height={55} /></Box>
        : trends.isError ? <Alert severity="warning" sx={{ m: 2 }} action={<Button color="inherit" onClick={() => void trends.refetch()}>{t("feed.retry")}</Button>}>{t("hot_topics.failed")}</Alert>
        : !tags.length ? <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>{t("hot_topics.empty")}</Typography>
        : <>
          {tags.map((trend, index) => (
            <ButtonBase key={trend.tag} onClick={() => setSelectedTag(trend.tag)} aria-pressed={activeTag === trend.tag}
              sx={{ width: "100%", display: "flex", textAlign: "left", justifyContent: "space-between", gap: 1, px: 2, py: 1.25,
                bgcolor: activeTag === trend.tag ? "action.selected" : "transparent",
                "&:hover": { bgcolor: "action.hover" }, "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary">{index + 1} · {t("common.trending_label")}</Typography>
                <Typography fontWeight={700} noWrap>#{trend.tag}</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{t("common.post_count", { count: trend.recentPostCount })}</Typography>
            </ButtonBase>
          ))}
          <Typography component="h3" variant="overline" color="text.secondary" sx={{ display: "block", px: 2, pt: 1.5, fontSize: 10, letterSpacing: "0.08em" }}>
            {t("hot_topics.conversation")}
          </Typography>
          {posts.isPending ? <Box sx={{ px: 2 }}><Skeleton height={70} /><Skeleton height={70} /></Box>
            : posts.isError ? <Alert severity="warning" sx={{ m: 2 }} action={<Button color="inherit" onClick={() => void posts.refetch()}>{t("feed.retry")}</Button>}>{t("feed.load_failed")}</Alert>
            : !posts.data?.data.length ? <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>{t("hot_topics.no_posts")}</Typography>
            : posts.data.data.map((post) => (
              <Box key={post.publicId} component={RouterLink} to={`/posts/${post.publicId}`}
                sx={{ display: "block", px: 2, py: 1.5, color: "text.primary", textDecoration: "none", borderTop: 1, borderColor: "divider",
                  "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75, minWidth: 0 }}>
                  <Avatar src={buildAvatarUrl(post.user?.avatar, 24)} sx={{ width: 24, height: 24, fontSize: 11 }}>{post.user?.username?.charAt(0).toUpperCase()}</Avatar>
                  <Typography variant="caption" fontWeight={700} noWrap sx={{ minWidth: 0 }}>{post.user?.username || t("post.unknown_user")}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: "auto", flexShrink: 0 }}>{new Date(post.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Typography>
                </Box>
                <Typography variant="body2" sx={{ lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflowWrap: "anywhere" }}>
                  {post.body || t("profile.view_post")}
                </Typography>
              </Box>
            ))}
          <Button component={RouterLink} to={`/results?q=${encodeURIComponent(`#${activeTag}`)}`} fullWidth sx={{ justifyContent: "flex-start", borderRadius: 0, px: 2, py: 1.5 }}>
            {t("hot_topics.explore", { topic: activeTag })}
          </Button>
        </>}
    </Box>
  );
}
