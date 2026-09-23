import React from "react";
import { IPost } from "../types";
import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { buildMediaUrl, buildResponsiveCloudinarySrcSet, transformCloudinaryUrl } from "../lib/media";

interface MediaCardProps {
	post: IPost;
	onOpen?: (postPublicId: string) => void;
}

const MediaCard: React.FC<MediaCardProps> = ({ post, onOpen }) => {
	const navigate = useNavigate();

	const handleClick = () => {
		onOpen?.(post.publicId);
		navigate(`/posts/${post.publicId}`);
	};

	// Handle optional image URL
	const fullImageUrl = buildMediaUrl(post.url) ?? buildMediaUrl(post.image?.url);
	const optimizedImageUrl = transformCloudinaryUrl(fullImageUrl, { width: 900, crop: "limit" });
	const imageSrcSet = buildResponsiveCloudinarySrcSet(fullImageUrl, [240, 360, 480, 720, 900], { crop: "limit" });

	if (!fullImageUrl) return null;

	return (
		<Box
			sx={{
				width: "100%",
				paddingTop: "100%",
				position: "relative",
				cursor: "pointer",
				overflow: "hidden",
				bgcolor: "grey.200",
				"&:hover img": {
					transform: "scale(1.05)",
				},
			}}
			data-feed-card-id={post.publicId}
			onClick={handleClick}
		>
			<img
				src={optimizedImageUrl}
				srcSet={imageSrcSet}
				sizes="(max-width: 600px) 50vw, (max-width: 1200px) 33vw, 25vw"
				alt={post.body?.substring(0, 50) || "User media"}
				loading="lazy"
				decoding="async"
				width={900}
				height={900}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					width: "100%",
					height: "100%",
					objectFit: "cover",
					transition: "transform 0.3s ease",
				}}
			/>
		</Box>
	);
};

export default MediaCard;
