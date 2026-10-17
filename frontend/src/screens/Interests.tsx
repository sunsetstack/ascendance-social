import { useEffect, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../hooks/context/useAuth";
import Gallery from "../components/Gallery";
import { mapPost } from "../lib/mappers";
import type { InterestsResult } from "../features/feed/interests";
import type { FeedPreviewPage } from "../api/postApi";
import { feedIdentities } from "../features/feed/feedIdentity";
import { useIsFeedRestoreNavigation } from "../features/feed/feedRestoration";

export default function Interests() {
  const { t, i18n } = useTranslation();
  const { user, isLoggedIn, loading } = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<string[] | null>(null);
  const catalogue = useQuery({
    queryKey: ["interests", user?.publicId ?? "guest"],
    queryFn: async ({ signal }) => (await axiosClient.get<InterestsResult>("/api/feed/interests", { signal })).data,
    enabled: !loading,
  });
  const topic = params.get("topic") ?? "finance";
  const sort = params.get("sort") ?? "newest";
  const valid = !!catalogue.data?.catalogue.some((item) => item.id === topic)
    && ["newest", "top"].includes(sort) && params.getAll("topic").length <= 1 && params.getAll("sort").length <= 1;
  const feedId = feedIdentities.preview(`interests:${topic}:${sort}`, user?.publicId);
  const restoring = useIsFeedRestoreNavigation(feedId);
  const queryKey = ["interestFeed", feedId] as const;
  const feed = useInfiniteQuery({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({ topics: topic, sort, limit: "10" });
      if (pageParam) query.set("cursor", pageParam);
      const { data } = await axiosClient.get<FeedPreviewPage>(`/api/feed/interests/posts?${query}`, { signal });
      return { ...data, data: data.data.map(mapPost) };
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.hasMore ? page.nextCursor : undefined,
    enabled: !loading && valid,
    maxPages: 6,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    ...(restoring ? { refetchOnMount: false } : {}),
  });
  const mutation = useMutation({
    mutationFn: async (action: "select" | "reset") => {
      if (action === "reset") await axiosClient.delete("/api/feed/preferences");
      else await axiosClient.put("/api/feed/interests", { selected: draft ?? catalogue.data?.profile?.selected ?? [] });
    },
    onSuccess: async () => {
      setDraft(null);
      await Promise.all(["interests", "posts", "forYouFeed", "personalizedFeed"].map((key) => client.invalidateQueries({ queryKey: [key] })));
    },
  });
  const resetMutation = mutation.reset;
  useEffect(() => { setDraft(null); resetMutation(); }, [user?.publicId, resetMutation]);
  const change = (key: string, value: string): void => {
    setParams((current) => { const next = new URLSearchParams(current); next.set(key, value); return next; });
  };
  const label = (id: string): string => {
    const item = catalogue.data?.catalogue.find((entry) => entry.id === id);
    return item ? (i18n.resolvedLanguage?.startsWith("bg") ? item.nameBg : item.name) : id;
  };
  const selected = draft ?? catalogue.data?.profile?.selected ?? [];
  const learned = Object.entries(catalogue.data?.profile?.topics ?? {}).filter(([, score]) => score >= 0.1).sort((a, b) => b[1] - a[1]);

  return <Box sx={{ width: "100%", minWidth: 0 }}>
    <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
      <Typography component="h1" variant="h5" fontWeight={700}>{t("interests.title")}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>{t("interests.description")}</Typography>
      {catalogue.isPending ? <Typography sx={{ mt: 2 }}>{t("interests.loading")}</Typography> : catalogue.isError ?
        <Alert severity="error" action={<Button onClick={() => void catalogue.refetch()}>{t("feed.retry")}</Button>}>{t("interests.load_failed")}</Alert> : <>
        <Accordion disableGutters elevation={0} sx={{ mt: 2, bgcolor: "transparent", border: 1, borderColor: "divider", "&:before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>{t("interests.preferences")}</Typography></AccordionSummary>
        <AccordionDetails>
        <Typography component="h2" variant="subtitle1" sx={{ mb: 1 }}>{t("interests.chosen")}</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
          {catalogue.data.catalogue.map((item) => <Chip key={item.id} label={label(item.id)}
            color={selected.includes(item.id) ? "primary" : "default"}
            aria-pressed={selected.includes(item.id)} disabled={mutation.isPending}
            onClick={() => { mutation.reset(); setDraft(selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id]); }} />)}
        </Stack>
        {isLoggedIn ? <Button sx={{ mt: 1 }} disabled={draft === null || mutation.isPending} onClick={() => mutation.mutate("select")}>{t("interests.save")}</Button>
          : <Button component={RouterLink} to="/login" sx={{ mt: 1 }}>{t("interests.sign_in")}</Button>}
        {isLoggedIn && <Box sx={{ mt: 2 }}>
          <Typography component="h2" variant="subtitle1">{t("interests.learned")}</Typography>
          <Typography variant="body2" color="text.secondary">{t("interests.learned_help")}</Typography>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
            {learned.map(([id]) => <Chip key={id} label={label(id)} size="small" />)}
            {!learned.length && <Typography variant="body2">{t("interests.no_learning")}</Typography>}
          </Stack>
          <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
            {Object.entries(catalogue.data.profile?.formats ?? {}).filter(([, score]) => score >= 0.1)
              .sort((a, b) => b[1] - a[1]).map(([format]) => <Chip key={format} size="small" variant="outlined" label={t(`content_formats.${format}`)} />)}
          </Stack>
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate("reset")}>{t("interests.reset_learning")}</Button>
        </Box>}
        {mutation.isError && <Alert severity="error">{t("interests.save_failed")}</Alert>}
        {mutation.isSuccess && <Alert severity="success">{t("interests.saved")}</Alert>}
        </AccordionDetails>
        </Accordion>
        <Typography component="h2" variant="h6" sx={{ mt: 3, mb: 1 }}>{t("interests.browse")}</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
          {catalogue.data.catalogue.map((item) => <Chip key={item.id} label={label(item.id)}
            variant={topic === item.id ? "filled" : "outlined"} color={topic === item.id ? "primary" : "default"}
            aria-pressed={topic === item.id} onClick={() => change("topic", item.id)} />)}
        </Stack>
        <ToggleButtonGroup exclusive size="small" value={sort} sx={{ mt: 2 }} aria-label={t("feed.ordering")}
          onChange={(_event, value: string | null) => { if (value) change("sort", value); }}>
          <ToggleButton value="newest">{t("interests.newest")}</ToggleButton>
          <ToggleButton value="top">{t("interests.top")}</ToggleButton>
        </ToggleButtonGroup>
      </>}
    </Box>
    {catalogue.data && !valid ? <Alert severity="warning">{t("feed.invalid_settings")}</Alert> : feed.isError ?
      <Alert severity="error" action={<Button onClick={() => void feed.refetch()}>{t("feed.retry")}</Button>}>{t("feed.load_failed")}</Alert> : valid &&
      <Gallery posts={feed.data?.pages.flatMap((page) => page.data) ?? []}
        fetchNextPage={() => void feed.fetchNextPage()} hasNextPage={!!feed.hasNextPage}
        isFetchingNext={feed.isFetchingNextPage} isLoadingAll={feed.isPending} isFetchingAll={feed.isFetching}
        feedId={feedId} onRefresh={() => client.resetQueries({ queryKey, exact: true })}
        emptyTitle={t("interests.empty")} emptyDescription={t(sort === "top" ? "interests.empty_top_help" : "interests.empty_help")} />}
  </Box>;
}
