import { useState } from "react";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import axiosClient from "../api/axiosClient";
import { useAuth } from "../hooks/context/useAuth";
import type { InterestsResult } from "../features/feed/interests";

export default function InterestsOnboarding() {
  const { user, loading } = useAuth();
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const queryKey = ["interests", user?.publicId ?? "guest"];
  const interests = useQuery({
    queryKey,
    queryFn: async ({ signal }) => (await axiosClient.get<InterestsResult>("/api/feed/interests", { signal })).data,
    enabled: !loading && !!user && "isEmailVerified" in user && user.isEmailVerified === true,
  });
  const save = useMutation({
    mutationFn: async (choices: string[]) => {
      await axiosClient.put("/api/feed/interests", { selected: choices });
      return choices;
    },
    onSuccess: async (choices) => {
      await client.cancelQueries({ queryKey });
      client.setQueryData<InterestsResult>(queryKey, (current) => current?.profile ? {
        ...current, profile: { ...current.profile, selected: choices, onboardingCompleted: true },
      } : current);
      await Promise.all(["interests", "posts", "forYouFeed", "personalizedFeed"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ));
    },
  });
  const profile = interests.data?.profile;
  const open = !!profile && profile.onboardingCompleted === false;

  return (
    <Dialog open={open} maxWidth="sm" fullWidth aria-labelledby="interest-welcome-title" aria-describedby="interest-welcome-description">
      <DialogTitle id="interest-welcome-title" sx={{ px: 3, pt: 4, pb: 1 }}>
        <Typography component="span" sx={{ display: "block", color: "primary.main", fontSize: 13, fontWeight: 700, mb: 1 }}>
          {t("onboarding.eyebrow")}
        </Typography>
        {t("onboarding.title")}
      </DialogTitle>
      <DialogContent sx={{ px: 3 }}>
        <DialogContentText id="interest-welcome-description" sx={{ mb: 3 }}>
          {t("onboarding.description")}
        </DialogContentText>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, pb: 1 }}>
          {interests.data?.catalogue.map((topic) => (
            <Chip key={topic.id} label={i18n.resolvedLanguage?.startsWith("bg") ? topic.nameBg : topic.name}
              variant={selected.includes(topic.id) ? "filled" : "outlined"}
              color={selected.includes(topic.id) ? "primary" : "default"}
              aria-pressed={selected.includes(topic.id)} disabled={save.isPending}
              sx={{ height: 42, fontSize: 14 }}
              onClick={() => {
                save.reset();
                setSelected((current) => current.includes(topic.id) ? current.filter((id) => id !== topic.id) : [...current, topic.id]);
              }} />
          ))}
        </Box>
        {save.isError && <Alert severity="error" sx={{ mt: 2 }}>{t("interests.save_failed")}</Alert>}
      </DialogContent>
      <DialogActions sx={{ p: 3, pt: 1, justifyContent: "space-between" }}>
        <Button onClick={() => save.mutate([])} disabled={save.isPending}>{t("onboarding.skip")}</Button>
        <Button variant="contained" onClick={() => save.mutate(selected)} disabled={!selected.length || save.isPending}>
          {t(save.isPending ? "common.loading" : "onboarding.continue")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
