import React from "react";
import { Box, Button, Typography, alpha, useTheme } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { Link as RouterLink } from "react-router-dom";
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
        gap: 2.25,
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
          bgcolor: "transparent",
          pb: 1.25,
          pt: 1.5,
        }}
      >
        <SearchBox />
      </Box>

      {/* Trending Tags */}
      <Box
        sx={{
          bgcolor: alpha(theme.palette.background.paper, 0.82),
          borderRadius: 5,
          overflow: "hidden",
          border: `1px solid ${theme.palette.divider}`,
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.18)",
        }}
      >
        <TrendingTags />
      </Box>

      {/* Who to Follow - not shown when logged in or when in messages screen*/}
      {isLoggedIn && (
        <Box
          sx={{
            bgcolor: alpha(theme.palette.background.paper, 0.82),
            borderRadius: 5,
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
            borderRadius: 5,
            border: `1px solid ${theme.palette.divider}`,
            textAlign: "left",
            overflow: "hidden",
            position: "relative",
            background: `linear-gradient(145deg, ${alpha(theme.palette.primary.main, 0.14)}, ${alpha(theme.palette.secondary.main, 0.09)} 55%, ${alpha(theme.palette.background.paper, 0.88)})`,
            boxShadow: "0 20px 50px rgba(0, 0, 0, 0.18)",
            "&::after": {
              content: '""',
              position: "absolute",
              width: 130,
              height: 130,
              borderRadius: "50%",
              right: -70,
              top: -75,
              background: alpha(theme.palette.primary.main, 0.13),
              filter: "blur(2px)",
            },
          }}
        >
          <Typography
            variant="overline"
            sx={{ color: "primary.light", fontWeight: 800, letterSpacing: "0.14em" }}
          >
            {t("marketing.guest_cta_eyebrow")}
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5, mb: 1, fontWeight: 800, letterSpacing: "-0.03em" }}>
            {t("marketing.new_to_ascendance")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6, mb: 2.25 }}>
            {t("marketing.sign_up_timeline")}
          </Typography>
          <Button
            component={RouterLink}
            to="/register"
            variant="contained"
            endIcon={<ArrowForwardRoundedIcon />}
            sx={{ px: 2.25, py: 1, background: "linear-gradient(90deg, #0ea5e9, #7c3aed)" }}
          >
            {t("auth.join")}
          </Button>
        </Box>
      )}
    </Box>
  );
};

export default RightSidebar;
