import React from "react";
import {
  Box,
  Typography,
  CircularProgress,
  alpha,
  useTheme,
  ListItemButton,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { feedApi } from "../api/feedApi";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

const TrendingTags: React.FC = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();

  const timeWindowHours = 24;
  const limit = 5;
  const { data, isLoading, error } = useQuery({
    queryKey: ["trending-tags", limit, timeWindowHours],
    queryFn: () => feedApi.getTrendingTags(limit, timeWindowHours),
    staleTime: 1000 * 60 * 60,
    refetchInterval: 1000 * 60 * 60,
  });

  const handleTagClick = (tag: string) => {
    navigate(`/results?q=${encodeURIComponent(`#${tag}`)}`);
  };

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, mb: 2 }}>
          {t("common.trends_for_you")}
        </Typography>
        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
          <CircularProgress size={24} />
        </Box>
      </Box>
    );
  }

  if (error || !data || data.tags.length === 0) {
    return null;
  }

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 800, px: 2, py: 1.5 }}>
        {t("common.trends_for_you")}
      </Typography>
      <Box sx={{ display: "flex", flexDirection: "column" }}>
        {data.tags.map((trendingTag) => (
          <ListItemButton
            key={trendingTag.tag}
            onClick={() => handleTagClick(trendingTag.tag)}
            sx={{
              px: 2,
              py: 1.5,
              display: "block",
              "&:hover": {
                backgroundColor: alpha(theme.palette.text.primary, 0.03),
              },
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              Trending
            </Typography>
            <Typography variant="body1" fontWeight={700} display="block">
              #{trendingTag.tag}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              {trendingTag.count} posts
            </Typography>
          </ListItemButton>
        ))}
      </Box>
    </Box>
  );
};

export default TrendingTags;
