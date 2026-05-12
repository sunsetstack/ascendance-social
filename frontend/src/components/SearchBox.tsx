import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, alpha, useTheme } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useTranslation } from "react-i18next";
import MentionInput from "./MentionInput";

const SearchBox: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      navigate(`/results?q=${encodeURIComponent(searchTerm.trim())}`);
      setSearchTerm("");
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSearchSubmit}
      sx={{
        position: "relative",
        borderRadius: 9999,
        backgroundColor: isFocused
          ? "transparent"
          : alpha(theme.palette.common.white, 0.08),
        border: `1px solid ${isFocused ? theme.palette.primary.main : "transparent"}`,
        "&:hover": {
          backgroundColor: isFocused
            ? "transparent"
            : alpha(theme.palette.common.white, 0.12),
        },
        width: "100%",
        transition: "all 0.2s ease",
        display: "flex",
        alignItems: "center",
      }}
    >
      <Box
        sx={{
          padding: theme.spacing(0, 2),
          height: "100%",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <SearchIcon
          sx={{
            color: isFocused
              ? theme.palette.primary.main
              : alpha(theme.palette.text.primary, 0.6),
          }}
        />
      </Box>
      <MentionInput
        value={searchTerm}
        onChange={setSearchTerm}
        context="search"
        placeholder={t("nav.search_placeholder")}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        sx={{
          flex: 1,
          fontSize: "0.95rem",
          lineHeight: 1.5,
          border: "none",
          backgroundColor: "transparent",
          "&:hover": { backgroundColor: "transparent" },
          "&:focus-within": { backgroundColor: "transparent" },
          "& .MuiInputBase-input": {
            padding: theme.spacing(1.5, 1, 1.5, 0),
          },
        }}
      />
    </Box>
  );
};

export default SearchBox;
