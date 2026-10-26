import { Alert, Autocomplete, Box, Button, FormControlLabel, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Gallery from "./Gallery";
import { useTags } from "../hooks/posts/usePosts";
import { useFeedPreview } from "../hooks/posts/useFeedPreview";
import { defaultFeedPreview, readFeedPreview, writeFeedPreview, type FeedPreviewDefinition } from "../features/feed/feedPreview";

export default function FeedPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { definition, valid } = readFeedPreview(params);
  const tags = useTags();
  const query = useFeedPreview(definition, valid);
  const posts = query.data?.pages.flatMap((page) => page.data) ?? [];
  const options = [...new Set([
    ...(tags.data ?? []).map((tag) => tag.tag), ...definition.topics,
  ])].sort();

  const change = (next: FeedPreviewDefinition): void => {
    setParams((current) => writeFeedPreview(current, next), { replace: true });
  };
  const reset = (): void => change(defaultFeedPreview);

  return (
    <Box>
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" sx={{ mb: 1 }}>{t("feed.builder_title")}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("feed.builder_description")}
        </Typography>
        <Autocomplete
          multiple
          filterSelectedOptions
          options={options}
          value={definition.topics}
          loading={tags.isPending}
          getOptionLabel={(topic) => `#${topic}`}
          getOptionDisabled={(topic) => definition.topics.length >= 5 && !definition.topics.includes(topic)}
          onChange={(_event, topics) => change({ ...definition, topics })}
          renderInput={(inputParams) => (
            <TextField {...inputParams} label={t("feed.topics")} helperText={t("feed.topics_help")} />
          )}
        />
        {tags.isError && (
          <Alert severity="warning" sx={{ mt: 1 }} action={
            <Button color="inherit" onClick={() => void tags.refetch()}>{t("feed.retry")}</Button>
          }>{t("feed.topics_failed")}</Alert>
        )}
        <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap", mt: 2 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={definition.sort}
            aria-label={t("feed.ordering")}
            onChange={(_event, sort: FeedPreviewDefinition["sort"] | null) => {
              if (sort) change({ ...definition, sort });
            }}
          >
            <ToggleButton value="latest">{t("feed.latest")}</ToggleButton>
            <ToggleButton value="relevant">{t("feed.relevant")}</ToggleButton>
          </ToggleButtonGroup>
          <FormControlLabel label={t("feed.include_reposts")} control={
            <Switch checked={definition.includeReposts} onChange={(_event, includeReposts) => change({ ...definition, includeReposts })} />
          } />
          <Button onClick={reset}>{t("feed.reset")}</Button>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t(definition.sort === "relevant" ? "feed.relevant_help" : "feed.latest_help")}
        </Typography>
      </Box>
      {!valid ? (
        <Alert severity="warning" sx={{ m: 2 }} action={<Button color="inherit" onClick={reset}>{t("feed.reset")}</Button>}>
          {t("feed.invalid_settings")}
        </Alert>
      ) : query.isError ? (
        <Alert severity="error" sx={{ m: 2 }} action={
          <Button color="inherit" onClick={() => void query.refetch()}>{t("feed.retry")}</Button>
        }>{t("feed.load_failed")}</Alert>
      ) : (
        <>
          <Typography component="h2" variant="subtitle2" sx={{ px: 2, pt: 2 }} aria-live="polite">
            {query.isFetching && posts.length === 0
              ? t("feed.preview_loading")
              : t("feed.preview_count", { count: posts.length })}
          </Typography>
          <Gallery
            posts={posts}
            fetchNextPage={() => void query.fetchNextPage()}
            hasNextPage={!!query.hasNextPage}
            isFetchingNext={query.isFetchingNextPage}
            isLoadingAll={query.isPending}
            isFetchingAll={query.isFetching}
            feedId={query.feedId}
            onRefresh={query.refreshFeed}
            emptyTitle={t("feed.preview_empty_title")}
            emptyDescription={t("feed.preview_empty_description")}
            emptyAction={
              <Box sx={{ display: "flex", gap: 1, justifyContent: "center", flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={reset}>{t("feed.reset")}</Button>
                <Button component={RouterLink} to="/communities">{t("feed.find_communities")}</Button>
              </Box>
            }
          />
        </>
      )}
    </Box>
  );
}
