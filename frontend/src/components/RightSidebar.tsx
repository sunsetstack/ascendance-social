import React from "react";
import { Box, Typography, alpha, useTheme } from "@mui/material";
import WhoToFollow from "./WhoToFollow";
import SearchBox from "./SearchBox";
import TrendingTags from "./TrendingTags";
import { useAuth } from "../hooks/context/useAuth";
import { useTranslation } from "react-i18next";

const RightSidebar: React.FC = () => {
  const { t } = useTranslation();
  const { isLoggedIn } = useAuth();
  const theme = useTheme();

  return (
    <Box
      component="aside"
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        pb: 4,
        height: "100%",
      }}
    >
      {/* Search Box - Sticky at top */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          bgcolor: "background.default",
          pb: 1,
          pt: 1,
        }}
      >
        <SearchBox />
      </Box>

      {/* Trending Tags */}
      <Box
        sx={{
          bgcolor: alpha(theme.palette.background.paper, 0.5),
          borderRadius: 4,
          overflow: "hidden",
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <TrendingTags />
      </Box>

      {/* Who to Follow - not shown when logged in or when in messages screen*/}
      {isLoggedIn && (
        <Box
          sx={{
            bgcolor: alpha(theme.palette.background.paper, 0.5),
            borderRadius: 4,
            overflow: "hidden",
            border: `1px solid ${theme.palette.divider}`,
          }}
        >
          <WhoToFollow limit={3} />
        </Box>
      )}

      {/* Login prompt for non-authenticated users */}
      {!isLoggedIn && (
        <Box
          sx={{
            p: 3,
            borderRadius: 4,
            border: `1px solid ${theme.palette.divider}`,
            textAlign: "center",
          }}
        >
          <Typography variant="h6" sx={{ mb: 1, fontWeight: 700 }}>
            {t("marketing.new_to_peek")}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("marketing.sign_up_timeline")}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default RightSidebar;
