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
          width: "100%",
          maxWidth: 600,
          bgcolor: "background.paper",
          borderRadius: 2,
          boxShadow: 24,
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
          <Typography variant="h6" fontWeight={600}>
            {t("nav.create_post")}
          </Typography>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>

        {/* CreatePost Component */}
        <CreatePost onClose={onClose} />
      </Box>
    </Modal>
  );
};

export default UploadForm;
