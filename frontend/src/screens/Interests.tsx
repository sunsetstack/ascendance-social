import { useEffect, useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../hooks/context/useAuth";
import Gallery from "../components/Gallery";
import type { InterestsResult } from "../features/feed/interests";
import { useInterestFeed } from "../hooks/posts/useInterestFeed";

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
  const feed = useInterestFeed(topic, sort, !loading && valid);
  const mutation = useMutation({
    mutationFn: async () => {
      await axiosClient.put("/api/feed/interests", { selected: draft ?? catalogue.data?.profile?.selected ?? [] });
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

  return <Box sx={{ width: "100%", minWidth: 0 }}>
    <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
      <Typography component="h1" variant="h5" fontWeight={700}>{t("interests.title")}</Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>{t("interests.description")}</Typography>
      {catalogue.isPending ? <Typography sx={{ mt: 2 }}>{t("interests.loading")}</Typography> : catalogue.isError ?
        <Alert severity="error" action={<Button onClick={() => void catalogue.refetch()}>{t("feed.retry")}</Button>}>{t("interests.load_failed")}</Alert> : <>
        {isLoggedIn && <Accordion disableGutters elevation={0} sx={{ mt: 2, bgcolor: "transparent", border: 1, borderColor: "divider", "&:before": { display: "none" } }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography>{t("interests.preferences")}</Typography></AccordionSummary>
        <AccordionDetails>
        <Typography component="h2" variant="subtitle1" sx={{ mb: 1 }}>{t("interests.chosen")}</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1}>
          {catalogue.data.catalogue.map((item) => <Chip key={item.id} label={label(item.id)}
            color={selected.includes(item.id) ? "primary" : "default"}
            aria-pressed={selected.includes(item.id)} disabled={mutation.isPending}
            onClick={() => { mutation.reset(); setDraft(selected.includes(item.id) ? selected.filter((id) => id !== item.id) : [...selected, item.id]); }} />)}
        </Stack>
        {isLoggedIn ? <Button sx={{ mt: 1 }} disabled={draft === null || mutation.isPending} onClick={() => mutation.mutate()}>{t("interests.save")}</Button>
          : <Button component={RouterLink} to="/login" sx={{ mt: 1 }}>{t("interests.sign_in")}</Button>}
        {mutation.isError && <Alert severity="error">{t("interests.save_failed")}</Alert>}
        {mutation.isSuccess && <Alert severity="success">{t("interests.saved")}</Alert>}
        </AccordionDetails>
        </Accordion>}
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
        feedId={feed.feedId} onRefresh={feed.refreshFeed}
        emptyTitle={t("interests.empty")} emptyDescription={t(sort === "top" ? "interests.empty_top_help" : "interests.empty_help")} />}
  </Box>;
}
