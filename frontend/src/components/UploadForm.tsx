import React from "react";
import { Modal, Box, IconButton, Typography, useTheme } from "@mui/material";
import { Close as CloseIcon } from "@mui/icons-material";
import { UploadFormProps } from "../types";
import CreatePost from "./CreatePost";
import { useTranslation } from "react-i18next";

const UploadForm: React.FC<UploadFormProps> = ({ onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Modal
      open={true}
      onClose={onClose}
      aria-labelledby="create-post-modal"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: "calc(100% - 24px)",
          maxWidth: 600,
          bgcolor: "background.paper",
          borderRadius: 2,
          border: 1,
          borderColor: "divider",
          boxShadow: "0 20px 60px rgba(0, 0, 0, 0.4)",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        {/* Modal Header */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 2,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography id="create-post-modal" variant="h6" fontWeight={600}>
            {t("nav.create_post")}
          </Typography>
          <IconButton aria-label="Close create post" onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* CreatePost Component */}
        <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
          <CreatePost onClose={onClose} />
        </Box>
      </Box>
    </Modal>
  );
};

export default UploadForm;
