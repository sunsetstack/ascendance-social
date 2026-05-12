import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu,
  MenuItem,
  IconButton,
  Avatar,
  Modal,
  Box,
  Typography,
} from "@mui/material";
import { ChevronDown, UploadIcon } from "lucide-react";
import UploadForm from "./UploadForm";
import { useAuth } from "../hooks/context/useAuth";
import { useCurrentUser } from "../hooks/user/useUsers";
import { useTranslation } from "react-i18next";

const BASE_URL = "/api";

const modalStyle = {
  position: "absolute",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  width: 400,
  bgcolor: "background.paper",
  boxShadow: 24,
  p: 4,
  borderRadius: 2,
};

const ProfileMenu = () => {
  const { t } = useTranslation();
  const { logout } = useAuth(); // Only need logout from auth context
  const { data: user, isLoading } = useCurrentUser();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const navigate = useNavigate();

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    logout();
    navigate("/");
    handleMenuClose();
  };

  const openModal = () => setIsModalOpen(true);
  const closeModal = () => setIsModalOpen(false);

  // Don't render if loading or no user
  if (isLoading || !user) {
    return null;
  }

  // Handle undefined avatar safely
  const avatarUrl = user.avatar || "";
  const fullAvatarUrl = avatarUrl.startsWith("http")
    ? avatarUrl
    : avatarUrl.startsWith("/")
      ? `${BASE_URL}${avatarUrl}`
      : avatarUrl
        ? `${BASE_URL}/${avatarUrl}`
        : undefined;

  return (
    <>
      <IconButton
        size="large"
        edge="end"
        onClick={handleMenuOpen}
        color="inherit"
      >
        <Avatar src={fullAvatarUrl} sx={{ width: 32, height: 32 }} />
        <ChevronDown size={16} style={{ marginLeft: 8 }} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={handleMenuClose}>
          <Link
            to={`/profile/${user.handle}`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            {t("nav.profile")}
          </Link>
        </MenuItem>
        <MenuItem onClick={openModal}>
          <UploadIcon size={16} style={{ marginRight: 8 }} />
          {t("nav.create_post")}
        </MenuItem>
        <MenuItem onClick={handleLogout}>{t("auth.logout")}</MenuItem>
      </Menu>
      <Modal
        open={isModalOpen}
        onClose={closeModal}
        aria-labelledby="upload-modal-title"
        aria-describedby="upload-modal-description"
      >
        <Box sx={modalStyle}>
          <Typography
            id="upload-modal-title"
            variant="h6"
            component="h2"
            sx={{ mb: 2 }}
          >
            {t("nav.create_post")}
          </Typography>
          <UploadForm onClose={closeModal} />
        </Box>
      </Modal>
    </>
  );
};

export default ProfileMenu;
