import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Avatar,
  IconButton,
  TextField,
  InputAdornment,
} from "@mui/material";
import { Menu as MenuIcon, Search as SearchIcon } from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useAuth } from "../../hooks/context/useAuth";
import { buildAvatarUrl } from "../../lib/media";

const HEADER_HEIGHT = 48;

interface MobileHeaderProps {
  onMenuClick: () => void;
}

const MobileHeader: React.FC<MobileHeaderProps> = ({ onMenuClick }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);

  const fullAvatarUrl = buildAvatarUrl(user?.avatar, 32);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/results?q=${encodeURIComponent(searchQuery.trim())}`);
      setSearchQuery("");
      setIsSearchExpanded(false);
    }
  };

  const handleSearchIconClick = () => {
    if (isSearchExpanded && searchQuery.trim()) {
      handleSearch({ preventDefault: () => {} } as React.FormEvent);
    } else {
      setIsSearchExpanded(!isSearchExpanded);
    }
  };

  return (
    <Box
      component="header"
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 1000,
        height: HEADER_HEIGHT,
        minHeight: HEADER_HEIGHT,
        bgcolor: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: `1px solid ${theme.palette.divider}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        px: 1,
        // safe area for notched devices
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {/* left: hamburger menu */}
      <IconButton
        onClick={onMenuClick}
        aria-label="Open navigation menu"
        sx={{
          color: theme.palette.text.primary,
          width: 44,
          height: 44,
        }}
      >
        <MenuIcon />
      </IconButton>

      {/* center: brand or search */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          mx: 1,
        }}
      >
        {isSearchExpanded ? (
          <Box
            component="form"
            onSubmit={handleSearch}
            sx={{ width: "100%", maxWidth: 400 }}
          >
            <TextField
              size="small"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              fullWidth
              onBlur={() => {
                if (!searchQuery.trim()) {
                  setIsSearchExpanded(false);
                }
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon
                      sx={{ color: "text.secondary", fontSize: 20 }}
                    />
                  </InputAdornment>
                ),
                sx: {
                  borderRadius: 3,
                  bgcolor: "rgba(255, 255, 255, 0.08)",
                  "& fieldset": { border: "none" },
                  height: 36,
                  fontSize: "0.875rem",
                },
              }}
            />
          </Box>
        ) : (
          <Box
            component="span"
            sx={{
              fontFamily: '"Montserrat", sans-serif',
              fontWeight: 800,
              fontSize: "1.1rem",
              color: theme.palette.primary.main,
              letterSpacing: "-0.5px",
            }}
          >
            Ascendance
          </Box>
        )}
      </Box>

      {/* right: search icon or avatar */}
      {isSearchExpanded ? (
        <IconButton
          onClick={() => setIsSearchExpanded(false)}
          aria-label="Close search"
          sx={{
            color: theme.palette.text.secondary,
            width: 44,
            height: 44,
          }}
        >
          ✕
        </IconButton>
      ) : (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <IconButton
            onClick={handleSearchIconClick}
            aria-label="Search"
            sx={{
              color: theme.palette.text.primary,
              width: 44,
              height: 44,
            }}
          >
            <SearchIcon />
          </IconButton>
          {user && (
            <Avatar
              src={fullAvatarUrl}
              onClick={() => navigate(`/profile/${user.handle}`)}
              sx={{
                width: 32,
                height: 32,
                cursor: "pointer",
              }}
            >
              {user.username?.charAt(0).toUpperCase()}
            </Avatar>
          )}
        </Box>
      )}
    </Box>
  );
};

export default MobileHeader;
export { HEADER_HEIGHT };
