import React from "react";
import {
  IconButton,
  Badge,
  Box,
  Typography,
  alpha,
  useTheme,
} from "@mui/material";
import { Notifications as NotificationsIcon } from "@mui/icons-material";
import { useNotifications } from "../hooks/notifications/useNotification";
import { useNavigate } from "react-router-dom";

const NotificationBell = () => {
  const { notifications } = useNotifications();
  const navigate = useNavigate();
  const theme = useTheme();
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const handleClick = () => {
    navigate("/notifications");
  };

  return (
    <Box
      onClick={handleClick}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 2,
        py: 1.5,
        borderRadius: 2,
        cursor: "pointer",
        transition: "all 0.2s ease",
        "&:hover": {
          backgroundColor: alpha(theme.palette.common.white, 0.05),
        },
      }}
    >
      <IconButton
        size="medium"
        sx={{
          color:
            unreadCount > 0
              ? theme.palette.primary.main
              : theme.palette.text.secondary,
        }}
      >
        <Badge
          badgeContent={unreadCount}
          max={9}
          sx={{
            "& .MuiBadge-badge": {
              background: "linear-gradient(45deg, #ec4899, #f472b6)",
              color: "white",
              fontWeight: 600,
              fontSize: "0.7rem",
              minWidth: 18,
              height: 18,
              padding: "0 4px",
            },
          }}
        >
          <NotificationsIcon />
        </Badge>
      </IconButton>
      <Typography
        variant="body2"
        sx={{
          fontWeight: 500,
          color:
            unreadCount > 0
              ? theme.palette.primary.main
              : theme.palette.text.primary,
        }}
      >
        Notifications
      </Typography>
    </Box>
  );
};

export default NotificationBell;
