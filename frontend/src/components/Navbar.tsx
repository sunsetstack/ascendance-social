import React, { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/context/useAuth";
import {
  AppBar,
  Toolbar,
  Button,
  InputBase,
  alpha,
  Box,
  Container,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import NotificationBell from "./NotificationBell";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import { useTranslation } from "react-i18next";

const Navbar = () => {
  const { t } = useTranslation();
  const { isLoggedIn, user } = useAuth();
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchTerm, setSearchTerm] = useState("");

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      navigate(`/results?q=${encodeURIComponent(searchTerm.trim())}`);
      setSearchTerm("");
    }
  };

  const isAdmin = user && "isAdmin" in user && user.isAdmin === true;

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        backgroundColor: "transparent",
        borderBottom: "none",
      }}
    >
      <Container maxWidth="xl">
        <Toolbar sx={{ px: { xs: 6, sm: 2 } }}>
          {/* Spacer for desktop */}
          <Box sx={{ display: { xs: "none", md: "block" }, flexGrow: 0.3 }} />

          {/* Search Bar - Enhanced */}
          <Box
            component="form"
            onSubmit={handleSearchSubmit}
            sx={{
              position: "relative",
              borderRadius: 3,
              backgroundColor: alpha(theme.palette.common.white, 0.08),
              border: "1px solid rgba(99, 102, 241, 0.3)",
              "&:hover": {
                backgroundColor: alpha(theme.palette.common.white, 0.12),
                borderColor: "rgba(99, 102, 241, 0.5)",
              },
              "&:focus-within": {
                borderColor: theme.palette.primary.main,
                boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
              },
              marginRight: theme.spacing(2),
              width: { xs: "200px", sm: "280px", md: "400px", lg: "500px" },
              transition: "all 0.3s ease",
              flexGrow: 1,
              maxWidth: "500px",
            }}
          >
            <Box
              sx={{
                padding: theme.spacing(0, 2),
                height: "100%",
                position: "absolute",
                pointerEvents: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SearchIcon
                sx={{ color: alpha(theme.palette.text.primary, 0.6) }}
              />
            </Box>
            <InputBase
              placeholder="Search tags/users…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              inputProps={{ "aria-label": "search" }}
              sx={{
                color: "inherit",
                width: "100%",
                "& .MuiInputBase-input": {
                  padding: theme.spacing(1.5, 1, 1.5, 0),
                  paddingLeft: `calc(1em + ${theme.spacing(4)})`,
                  fontSize: "0.95rem",
                },
              }}
            />
          </Box>

          {/* Spacer */}
          <Box sx={{ flexGrow: 1 }} />

          {/* Auth & Notifications */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            {isLoggedIn ? (
              <>
                {isAdmin && (
                  <Button
                    component={RouterLink}
                    to="/admin"
                    variant="outlined"
                    size="small"
                    startIcon={<AdminPanelSettingsIcon />}
                    sx={{
                      borderColor: alpha(theme.palette.warning.main, 0.5),
                      color: theme.palette.warning.light,
                      "&:hover": {
                        borderColor: theme.palette.warning.main,
                        backgroundColor: alpha(theme.palette.warning.main, 0.1),
                      },
                    }}
                  >
                    admin tools
                  </Button>
                )}
                <NotificationBell />
              </>
            ) : (
              <>
                <Button
                  component={RouterLink}
                  to="/login"
                  variant="outlined"
                  size="small"
                  sx={{
                    borderColor: alpha(theme.palette.primary.main, 0.5),
                    color: theme.palette.primary.light,
                    "&:hover": {
                      borderColor: theme.palette.primary.main,
                      backgroundColor: alpha(theme.palette.primary.main, 0.1),
                    },
                  }}
                >
                  {t("auth.login")}
                </Button>
                <Button
                  component={RouterLink}
                  to="/register"
                  variant="contained"
                  size="small"
                  sx={{
                    background: "linear-gradient(45deg, #0ea5e9, #38bdf8)",
                    "&:hover": {
                      background: "linear-gradient(45deg, #0284c7, #0ea5e9)",
                    },
                  }}
                >
                  {t("auth.join")}
                </Button>
              </>
            )}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
};

export default Navbar;
