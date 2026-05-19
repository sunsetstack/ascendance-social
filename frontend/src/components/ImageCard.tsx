import React from "react";
import { IImage } from "../types";
import {
  Card,
  CardMedia,
  CardActions,
  Typography,
  Chip,
  Box,
  Avatar,
  IconButton,
} from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CommentIcon from "@mui/icons-material/Comment";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import { buildMediaUrl, transformCloudinaryUrl } from "../lib/media";

interface ImageCardProps {
  image: IImage;
}

const ImageCard: React.FC<ImageCardProps> = ({ image }) => {
  const fullImageUrl = buildMediaUrl(image.url);
  const optimizedImageUrl = transformCloudinaryUrl(fullImageUrl, {
    width: 1400,
    crop: "limit",
  });
  const avatarUrl = transformCloudinaryUrl(buildMediaUrl(image.user?.avatar), {
    width: 64,
    height: 64,
    crop: "fill",
  });
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/images/${image.publicId}`);
  };
  return (
    <Card
      sx={{
        width: "100%",
        maxWidth: "700px",
        overflow: "hidden",
        background: "linear-gradient(145deg, #1a1a2e 0%, #16213e 100%)",
        border: "1px solid rgba(99, 102, 241, 0.2)",
        borderRadius: 3,
        cursor: "pointer",
        transition: "all 0.3s ease",
        "&:hover": {
          transform: "translateY(-8px)",
          borderColor: "rgba(99, 102, 241, 0.4)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4)",
        },
      }}
      onClick={handleClick}
    >
      {/* Enhanced image display */}
      <Box sx={{ position: "relative", overflow: "hidden" }}>
        <CardMedia
          component="img"
          sx={{
            maxHeight: "600px",
            objectFit: "cover",
            width: "100%",
            transition: "transform 0.3s ease",
            "&:hover": {
              transform: "scale(1.05)",
            },
          }}
          image={optimizedImageUrl}
          alt={image.publicId}
          loading="lazy"
          decoding="async"
        />
        {/* Gradient overlay for better text readability */}
        <Box
          sx={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "80px",
            background: "linear-gradient(transparent, rgba(0, 0, 0, 0.8))",
            pointerEvents: "none",
          }}
        />
      </Box>

      {/* Enhanced card actions */}
      <CardActions
        disableSpacing
        sx={{
          justifyContent: "space-between",
          px: 3,
          py: 2,
          background: "rgba(26, 26, 46, 0.9)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Avatar
            sx={{
              width: 32,
              height: 32,
              border: "2px solid rgba(99, 102, 241, 0.3)",
              background: "linear-gradient(45deg, #0ea5e9, #38bdf8)",
            }}
          >
            {image.user?.avatar ? (
              <img
                src={avatarUrl}
                alt={image.user.username}
                loading="lazy"
                decoding="async"
                width={32}
                height={32}
                style={{ width: "100%", height: "100%", borderRadius: "50%" }}
              />
            ) : (
              <span>{image.user?.username?.charAt(0).toUpperCase()}</span>
            )}
          </Avatar>
          <Box>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, color: "text.primary" }}
            >
              {image.user?.username || "Unknown"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {new Date(image.createdAt).toLocaleDateString()}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Chip
            icon={<FavoriteIcon fontSize="small" />}
            label={image.likes}
            size="small"
            sx={{
              background:
                "linear-gradient(45deg, rgba(236, 72, 153, 0.2), rgba(99, 102, 241, 0.2))",
              border: "1px solid rgba(236, 72, 153, 0.3)",
              color: "#ec4899",
              "& .MuiChip-icon": { color: "#ec4899" },
            }}
          />
          <Chip
            icon={<CommentIcon fontSize="small" />}
            label={image.commentsCount || 0}
            size="small"
            sx={{
              background:
                "linear-gradient(45deg, rgba(59, 130, 246, 0.2), rgba(99, 102, 241, 0.2))",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              color: "#3b82f6",
              "& .MuiChip-icon": { color: "#3b82f6" },
            }}
          />
          <IconButton
            size="small"
            sx={{
              color: "primary.light",
              "&:hover": {
                color: "primary.main",
                transform: "scale(1.1)",
              },
            }}
          >
            <VisibilityIcon fontSize="small" />
          </IconButton>
        </Box>
      </CardActions>
    </Card>
  );
};

export default ImageCard;
